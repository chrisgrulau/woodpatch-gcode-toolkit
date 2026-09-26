// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { evaluate, type ParameterReader } from '../expr/evaluate.js';
import { parseExpression } from '../expr/parse.js';
import { LINUXCNC_RULES, type ExpressionRules } from '../expr/rules.js';
import type { Diagnostic, Line, Program, Severity, Span, Value } from '../syntax/types.js';
import { G_CODES, M_CODES, codeKey } from './codes.js';
import { LINUXCNC_INTERPRETER_RULES, type InterpreterRules } from './rules.js';
import { cycleOps, type CycleCode } from './cycles.js';
import {
  AXES,
  type Axis,
  type Feed,
  type InterpretOptions,
  type InterpretResult,
  type ModalState,
  type Plane,
  type Position,
  type Step,
} from './types.js';

/**
 * Interprets a parsed program into machine steps (parcel 2c-1, ADR-0019).
 *
 * Each line runs in RS274/NGC's **order of execution** (LinuxCNC G-code overview,
 * "Order of Execution"), not in the order its words are written. Upstream used
 * line order (ANALYSIS §4).
 *
 * A line that cannot be executed is reported, and its motion is skipped, so the tool
 * stays where it was: an unknown or not-yet-supported code, two codes from one modal
 * group, a repeated word, an expression error, or a missing feed. Upstream reported
 * such lines and then moved anyway (N5, N6). Never throws.
 *
 * Work offsets live in LinuxCNC's parameter layout, so a program that reads or
 * writes them sees consistent values:
 * - #5161- G28 home, #5181- G30 home;
 * - #5210/#5211- G92/G52 offset;
 * - #5220 the active coordinate system;
 * - #5221+20(n-1)- coordinate system n.
 * Values are stored in millimetres.
 */
export function interpret(program: Program, options: InterpretOptions = {}): InterpretResult {
  return new Interpreter(options).run(program);
}

const AXIS_INDEX: Readonly<Record<Axis, number>> = { X: 0, Y: 1, Z: 2, A: 3, B: 4, C: 5 };
const LINEAR: ReadonlySet<Axis> = new Set(['X', 'Y', 'Z']);
const ZERO: Position = Object.freeze({ X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });

/** Letters with a meaning somewhere in this interpreter. N is a line number, and ignored. */
const KNOWN_LETTERS = new Set('GMFSTXYZABCIJKRPQLHDN'.split(''));

/** Group-0 codes that consume the line's axis words, suspending group-1 motion. */
const AXIS_GROUP0 = new Set(['10', '28', '30', '52', '92']);

const PLANE_AXES: Readonly<Record<Plane, readonly [Axis, Axis]>> = {
  XY: ['X', 'Y'],
  ZX: ['Z', 'X'],
  YZ: ['Y', 'Z'],
};
const OFFSET_LETTER: Readonly<Record<Axis, string>> = {
  X: 'I',
  Y: 'J',
  Z: 'K',
  A: '',
  B: '',
  C: '',
};

const SPINDLE_CODES = [
  ['3', 'cw'],
  ['4', 'ccw'],
  ['5', 'off'],
] as const;
const IO_CODES = ['62', '63', '64', '65', '66', '67', '68'] as const;
const WCS_CODES = [
  ['54', 1],
  ['55', 2],
  ['56', 3],
  ['57', 4],
  ['58', 5],
  ['59', 6],
  ['59.1', 7],
  ['59.2', 8],
  ['59.3', 9],
] as const;
const MOTION_CODES = ['0', '1', '2', '3', '80', '73', '81', '82', '83'] as const;
const CYCLES: ReadonlySet<string> = new Set(['G73', 'G81', 'G82', 'G83']);

/** Letters the fast path accepts, as bits (any other letter takes the general path). */
const FAST_LETTERS: Readonly<Record<string, number>> = {
  X: 1,
  Y: 2,
  Z: 4,
  A: 8,
  B: 16,
  C: 32,
  F: 64,
  N: 128,
  G: 256,
};
/** The fast path has nothing to report as unused, so its "used" set is a no-op. */
const NO_USED = { add: (): void => {} };

/** Word letters as bits, for a cheap per-line "which letters were used" set. */
const bit = (letter: string) => 1 << (letter.charCodeAt(0) - 65);

interface Word {
  readonly letter: string;
  readonly value: number;
  readonly span: Span;
}

class Interpreter {
  private readonly rules: ExpressionRules;
  private readonly behaviour: InterpreterRules;
  private readonly blockDelete: boolean;
  private readonly steps: Step[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly numbered = new Map<number, number>();
  private readonly named = new Map<string, number>();
  private readonly params: ParameterReader;
  private readonly once = new Set<string>();
  /** Canned cycles: sticky R, Q, P and Z (program units converted to mm; P in seconds). */
  private cycleR: number | null = null;
  private cycleQ: number | null = null;
  private cycleP: number | null = null;
  private cycleZ: number | null = null;
  /** The level (machine Z) when the current run of canned cycles began; G98 returns here. */
  private cycleInitial: number | null = null;
  private offsetCache: Position | null = null;

  /** Immutable: replaced on every move, never mutated, so steps can share it safely. */
  private position: Position;
  private motion: ModalState['motion'] = 'G0';
  private plane: Plane = 'XY';
  private units: 'mm' | 'inch' = 'mm';
  private distance: 'absolute' | 'incremental' = 'absolute';
  private arcDistance: 'absolute' | 'incremental' = 'incremental';
  private feedMode: ModalState['feedMode'] = 'per-minute';
  private feedRate: number | null = null;
  private cutterComp: ModalState['cutterCompensation'] = 'off';
  private toolLength = false;
  private retract: ModalState['retract'] = 'initial';
  private pathControl: ModalState['pathControl'] = 'G64';
  private spindle: { state: 'cw' | 'ccw' | 'off'; rpm: number | null } = {
    state: 'off',
    rpm: null,
  };
  private mist = false;
  private flood = false;
  private tool: number | null = null;
  private selectedTool: number | null = null;
  private ended = false;
  private percentSeen = false;

  constructor(options: InterpretOptions) {
    this.rules = options.rules ?? LINUXCNC_RULES;
    this.behaviour = options.interpreterRules ?? LINUXCNC_INTERPRETER_RULES;
    this.blockDelete = options.blockDelete ?? true;
    this.position = { ...ZERO, ...options.start };
    this.numbered.set(5220, 1);
    this.params = {
      numbered: (i) => this.numbered.get(i) ?? 0,
      named: (n) => this.named.get(n),
    };
  }

  run(program: Program): InterpretResult {
    let skippedAfterEnd = 0;
    let firstSkipped = 0;
    for (const line of program.lines) {
      if (this.ended) {
        if (line.tokens.some((t) => t.kind !== 'comment' && t.kind !== 'percent')) {
          skippedAfterEnd++;
          firstSkipped ||= line.lineNo;
        }
        continue;
      }
      this.line(line);
    }
    if (skippedAfterEnd > 0) {
      this.diagnostics.push({
        severity: 'info',
        code: 'SEMANTIC_AFTER_PROGRAM_END',
        message: `${skippedAfterEnd} line(s) after the program end were not run`,
        line: firstSkipped,
      });
    }
    return { steps: this.steps, diagnostics: this.diagnostics, state: this.state() };
  }

  // ── One line ────────────────────────────────────────────────────────────

  private line(line: Line): void {
    if (this.fastLine(line)) return;
    const n = line.lineNo;
    const tokens = line.tokens;
    if (tokens.length === 0) return;

    // Syntax errors make the line unsafe to execute.
    if (line.diagnostics.some((d) => d.severity === 'error')) {
      this.report(n, 'error', 'SEMANTIC_LINE_NOT_RUN', 'Line not run: it has syntax errors');
      return;
    }

    if (tokens[0]?.kind === 'percent') {
      if (this.percentSeen) this.end(n, '%');
      this.percentSeen = true;
      return;
    }
    if (tokens[0]?.kind === 'block-delete' && this.blockDelete) {
      this.report(n, 'info', 'SEMANTIC_BLOCK_DELETED', 'Skipped: block delete ("/") is on');
      return;
    }
    if (tokens.some((t) => t.kind === 'oword')) {
      this.report(
        n,
        'error',
        'SEMANTIC_NOT_YET_SUPPORTED',
        'O-word control flow is not interpreted yet (parcel 2c-3); line not run',
      );
      return;
    }
    for (const t of tokens) {
      if (t.kind === 'checksum')
        this.report(n, 'warning', 'SEMANTIC_CHECKSUM_IGNORED', 'Line checksum ignored', t.span);
    }

    // 1. Evaluate every value with the parameters as they were BEFORE this line.
    const words: Word[] = [];
    const assignments: { target: string; value: number }[] = [];
    let bad = false;
    for (const t of tokens) {
      if (t.kind === 'word' && t.value) {
        const v = this.value(line, t.value);
        if (v === null) bad = true;
        else words.push({ letter: t.letter, value: v, span: t.span });
      } else if (t.kind === 'assignment' && t.value) {
        const v = this.value(line, t.value);
        const target = line.text.slice(t.target.start, t.target.end);
        if (v === null) bad = true;
        else assignments.push({ target, value: v });
      }
    }
    if (bad) {
      this.report(
        n,
        'error',
        'SEMANTIC_LINE_NOT_RUN',
        'Line not run: a value could not be evaluated',
      );
      return;
    }
    if (!this.checkLine(n, words)) return;

    this.execute(n, words);
    for (const a of assignments) this.assign(line, a.target, a.value);
  }

  /**
   * Fast path for the overwhelmingly common CAM line: plain-number X/Y/Z/A/B/C/F/N
   * words under a modal G0 or G1 (e.g. `X12.5 Y3.2 Z-1`). It does exactly what the
   * general path would, without that path's per-line allocations (ADR-0014 budget).
   * Anything else (G/M codes, expressions, repeats, arcs, syntax errors, negative F)
   * returns false and takes the general path, so behaviour cannot diverge.
   */
  private fastLine(line: Line): boolean {
    const tokens = line.tokens;
    if (tokens.length === 0 || line.diagnostics.length > 0) return false;
    let seen = 0;
    let f: number | undefined;
    let g: 'G0' | 'G1' | undefined;
    let axes = 0;
    for (const t of tokens) {
      if (t.kind === 'comment') continue;
      if (t.kind !== 'word' || t.value?.kind !== 'number') return false;
      const b = FAST_LETTERS[t.letter];
      if (b === undefined || (seen & b) !== 0) return false;
      seen |= b;
      const v = t.value.value;
      if (t.letter === 'G') {
        // Only a lone G0 or G1: it just sets the motion mode, as the general path would.
        if (v === 0) g = 'G0';
        else if (v === 1) g = 'G1';
        else return false;
      } else if (t.letter === 'F') {
        if (v < 0) return false;
        f = v;
      } else if (t.letter !== 'N') axes++;
    }
    const motion = g ?? this.motion;
    if (motion !== 'G0' && motion !== 'G1') return false;
    this.motion = motion;
    // An ordinary motion ends a run of canned cycles (as the general path does).
    this.cycleInitial = null;
    if (f !== undefined) {
      this.feedRate = this.feedMode === 'inverse-time' ? f : f * (this.units === 'inch' ? 25.4 : 1);
    }
    if (axes === 0) return true;
    const words: Word[] = [];
    for (const t of tokens) {
      if (t.kind === 'word' && t.value?.kind === 'number' && t.letter !== 'N' && t.letter !== 'G') {
        words.push({ letter: t.letter, value: t.value.value, span: t.span });
      }
    }
    this.move(line.lineNo, words, false, NO_USED);
    return true;
  }

  /** Letters, repeats and modal groups. False means: do not run the line. */
  private checkLine(n: number, words: readonly Word[]): boolean {
    let ok = true;
    let seenBits = 0;
    // Group → code, as small parallel arrays: most lines have no G or M word.
    const gGroups: number[] = [];
    const gGroupCodes: string[] = [];
    const mGroups: number[] = [];
    const mGroupCodes: string[] = [];
    for (const w of words) {
      if (!KNOWN_LETTERS.has(w.letter)) {
        const hint =
          w.letter === 'E' ? ' (G-code has no exponent notation: X1e3 is X1 then E3)' : '';
        this.report(
          n,
          'error',
          'SEMANTIC_UNSUPPORTED_WORD',
          `"${w.letter}" is not a word this dialect understands${hint}`,
          w.span,
        );
        ok = false;
        continue;
      }
      if (w.letter === 'G' || w.letter === 'M') {
        const table = w.letter === 'G' ? G_CODES : M_CODES;
        const key = codeKey(w.value);
        const info = table.get(key);
        if (!info) {
          this.report(
            n,
            'error',
            'SEMANTIC_UNSUPPORTED_CODE',
            `${w.letter}${key} is not supported; line not run`,
            w.span,
          );
          ok = false;
          continue;
        }
        if (info.later) {
          this.report(
            n,
            'error',
            'SEMANTIC_NOT_YET_SUPPORTED',
            `${w.letter}${key} is not interpreted yet: ${info.later}; line not run`,
            w.span,
          );
          ok = false;
          continue;
        }
        const groups = w.letter === 'G' ? gGroups : mGroups;
        const groupCodes = w.letter === 'G' ? gGroupCodes : mGroupCodes;
        const at = groups.indexOf(info.group);
        const prev = at === -1 ? undefined : groupCodes[at];
        // M7 and M8 may both be on (LinuxCNC Table 6).
        const coolantPair =
          w.letter === 'M' && info.group === 8 && [prev, key].sort().join() === '7,8';
        if (prev !== undefined && info.group !== 0 && !coolantPair) {
          this.report(
            n,
            'error',
            'SEMANTIC_MODAL_GROUP_CONFLICT',
            `${w.letter}${prev} and ${w.letter}${key} are in the same modal group; line not run`,
            w.span,
          );
          ok = false;
        }
        groups.push(info.group);
        groupCodes.push(key);
        continue;
      }
      if (w.letter === 'N') continue;
      if ((seenBits & bit(w.letter)) !== 0) {
        this.report(
          n,
          'error',
          'SEMANTIC_REPEATED_WORD',
          `"${w.letter}" appears more than once; line not run`,
          w.span,
        );
        ok = false;
      }
      seenBits |= bit(w.letter);
    }
    return ok;
  }

  // ── Execution in RS274 order ────────────────────────────────────────────

  private execute(n: number, words: readonly Word[]): void {
    const get = (letter: string) => words.find((w) => w.letter === letter);
    // One pass; most lines have no G or M word at all, so no set is built for them.
    const gCodes: string[] = [];
    const mCodes: string[] = [];
    for (const w of words) {
      if (w.letter === 'G') gCodes.push(codeKey(w.value));
      else if (w.letter === 'M') mCodes.push(codeKey(w.value));
    }
    const g = {
      has: (c: string) => gCodes.includes(c),
      [Symbol.iterator]: () => gCodes[Symbol.iterator](),
    };
    const m = { has: (c: string) => mCodes.includes(c) };
    let usedBits = bit('G') | bit('M') | bit('N') | bit('F') | bit('S') | bit('T');
    const used = {
      add: (l: string) => (usedBits |= bit(l)),
      has: (l: string) => (usedBits & bit(l)) !== 0,
    };

    // Feed rate mode (G93/G94/G95), then feed (F), spindle speed (S), tool select (T).
    if (g.has('93')) this.feedMode = 'inverse-time';
    if (g.has('94')) this.feedMode = 'per-minute';
    if (g.has('95')) this.feedMode = 'per-revolution';
    // Units (G20/G21) are step 12 and F is step 3, so by RS274 order F is read in the
    // units in force before this line's G20/G21. Controllers disagree on this, so it's
    // dialect data (InterpreterRules.feedUnits), and a line that actually changes units
    // alongside an F word gets a warning either way.
    const unitsAfter = g.has('20') ? 'inch' : g.has('21') ? 'mm' : this.units;
    const f = get('F');
    const feedUnits = this.behaviour.feedUnits === 'end-of-line' ? unitsAfter : this.units;
    if (f && unitsAfter !== this.units) {
      this.report(
        n,
        'warning',
        'SEMANTIC_FEED_UNITS_AMBIGUOUS',
        `F and a unit change (G${unitsAfter === 'inch' ? 20 : 21}) on one line: controllers disagree about F's units. Read here as ${feedUnits === 'inch' ? 'in' : 'mm'}/min`,
        f.span,
      );
    }
    if (f) {
      if (f.value < 0)
        this.report(n, 'error', 'SEMANTIC_NEGATIVE_FEED', 'Feed rate cannot be negative', f.span);
      else
        this.feedRate =
          this.feedMode === 'inverse-time' ? f.value : f.value * (feedUnits === 'inch' ? 25.4 : 1);
    }
    const s = get('S');
    if (s) {
      if (s.value < 0)
        this.report(
          n,
          'error',
          'SEMANTIC_NEGATIVE_SPEED',
          'Spindle speed cannot be negative',
          s.span,
        );
      else {
        this.spindle = { ...this.spindle, rpm: s.value };
        if (this.spindle.state !== 'off' && !m.has('3') && !m.has('4') && !m.has('5')) {
          this.steps.push({ kind: 'spindle', line: n, state: this.spindle.state, rpm: s.value });
        }
      }
    }
    const t = get('T');
    if (t) this.selectedTool = Math.round(t.value);

    // Tool change (M6), spindle (M3/M4/M5), coolant (M7/M8/M9), overrides (M48/M49).
    if (m.has('6')) {
      if (this.selectedTool === null)
        this.report(
          n,
          'warning',
          'SEMANTIC_TOOL_CHANGE_NO_TOOL',
          'M6 with no tool selected (no T word yet)',
        );
      this.tool = this.selectedTool;
      this.steps.push({ kind: 'tool-change', line: n, tool: this.tool });
    }
    for (const [code, state] of SPINDLE_CODES) {
      if (m.has(code)) {
        this.spindle = { ...this.spindle, state };
        this.steps.push({ kind: 'spindle', line: n, state, rpm: this.spindle.rpm });
      }
    }
    if (m.has('7') || m.has('8') || m.has('9')) {
      if (m.has('9')) this.mist = this.flood = false;
      if (m.has('7')) this.mist = true;
      if (m.has('8')) this.flood = true;
      this.steps.push({ kind: 'coolant', line: n, mist: this.mist, flood: this.flood });
    }
    for (const code of IO_CODES) {
      if (m.has(code))
        this.report(
          n,
          'warning',
          'SEMANTIC_IO_IGNORED',
          `M${code} (machine I/O) has no effect on the path; ignored`,
        );
    }

    // Dwell (G4).
    if (g.has('4')) {
      used.add('P');
      const p = get('P');
      if (!p) this.report(n, 'error', 'SEMANTIC_DWELL_WITHOUT_P', 'G4 needs a P word (seconds)');
      else if (p.value < 0)
        this.report(n, 'error', 'SEMANTIC_NEGATIVE_DWELL', 'Dwell time cannot be negative', p.span);
      else this.steps.push({ kind: 'dwell', line: n, seconds: this.dwellSeconds(p.value) });
    }

    // Plane, units, cutter compensation, tool length offset, coordinate system,
    // path control, distance modes, retract mode.
    if (g.has('17')) this.plane = 'XY';
    if (g.has('18')) this.plane = 'ZX';
    if (g.has('19')) this.plane = 'YZ';
    this.units = unitsAfter;
    if (g.has('40')) this.cutterComp = 'off';
    if (g.has('41') || g.has('42')) {
      used.add('D');
      this.cutterComp = g.has('41') ? 'left' : 'right';
      const d = get('D');
      this.report(
        n,
        'warning',
        'SEMANTIC_CUTTER_COMP_NOT_APPLIED',
        `Cutter compensation (G${g.has('41') ? 41 : 42}${d ? ` D${d.value}` : ''}) is not simulated: the path is drawn uncompensated (ADR-0016)`,
      );
    }
    if (g.has('43')) {
      used.add('H');
      this.toolLength = true;
      this.reportOnce(
        n,
        'info',
        'SEMANTIC_TOOL_LENGTH_NOT_APPLIED',
        'Tool length offsets are not applied (no tool table): Z is drawn as programmed',
      );
    }
    if (g.has('49')) this.toolLength = false;
    for (const [code, cs] of WCS_CODES) {
      if (g.has(code)) this.setParam(5220, cs);
    }
    if (g.has('61')) this.pathControl = 'G61';
    if (g.has('61.1')) this.pathControl = 'G61.1';
    if (g.has('64')) this.pathControl = 'G64';
    if (g.has('90')) this.distance = 'absolute';
    if (g.has('91')) this.distance = 'incremental';
    if (g.has('90.1')) this.arcDistance = 'absolute';
    if (g.has('91.1')) this.arcDistance = 'incremental';
    if (g.has('98')) this.retract = 'initial';
    if (g.has('99')) this.retract = 'r-plane';

    // Group-0 codes: home (G28/G30), coordinate data (G10), offsets (G52/G92).
    const axisWords = words.filter((w) => w.letter in AXIS_INDEX);
    const group0WithAxes = [...g].filter((c) => AXIS_GROUP0.has(c));
    const explicitMotion = MOTION_CODES.filter((c) => g.has(c));
    if (group0WithAxes.length > 1) {
      this.report(
        n,
        'error',
        'SEMANTIC_MODAL_GROUP_CONFLICT',
        `G${group0WithAxes.join(' and G')} both use axis words; line not run`,
      );
      return;
    }
    if (group0WithAxes.length === 1 && explicitMotion.length > 0 && axisWords.length > 0) {
      this.report(
        n,
        'error',
        'SEMANTIC_AXIS_WORDS_CONFLICT',
        `G${group0WithAxes[0]} and G${explicitMotion[0]} both want the axis words; line not run`,
      );
      return;
    }
    let motionSuspended = group0WithAxes.length === 1;
    if (motionSuspended) for (const w of axisWords) used.add(w.letter);
    if (g.has('28.1') || g.has('30.1')) this.storeHome(g.has('28.1') ? 5161 : 5181);
    if (g.has('10')) {
      used.add('L');
      used.add('P');
      used.add('R');
      this.g10(n, words);
    }
    if (g.has('92')) this.g92(words);
    if (g.has('52')) this.g52(words);
    if (g.has('92.1') || g.has('92.2')) {
      this.setParam(5210, 0);
      if (g.has('92.1')) for (const a of AXES) this.setParam(5211 + AXIS_INDEX[a], 0);
    }
    if (g.has('92.3')) this.setParam(5210, 1);
    if (g.has('28') || g.has('30')) {
      this.home(n, g.has('28') ? 5161 : 5181, words);
      motionSuspended = true;
    }

    // Motion (G0–G3, G80), possibly modified by G53.
    const priorMotion = this.motion;
    for (const c of explicitMotion) this.motion = `G${c}` as ModalState['motion'];
    // The cycle's initial level (LinuxCNC cycle_il) ends when any other motion runs.
    if (!CYCLES.has(this.motion)) this.cycleInitial = null;
    if (!motionSuspended && CYCLES.has(this.motion)) {
      if (axisWords.length > 0) this.cycle(n, words, priorMotion, used);
      else if (explicitMotion.length > 0)
        this.report(
          n,
          'error',
          'SEMANTIC_CYCLE_NO_AXES',
          `${this.motion} needs X, Y or Z; line not run`,
        );
    } else if (!motionSuspended) {
      const arcWords = words.some((w) => 'IJKR'.includes(w.letter));
      if (axisWords.length > 0 || (arcWords && (this.motion === 'G2' || this.motion === 'G3'))) {
        for (const w of axisWords) used.add(w.letter);
        this.move(n, words, g.has('53'), used);
      } else if (g.has('53')) {
        this.report(
          n,
          'warning',
          'SEMANTIC_G53_WITHOUT_MOTION',
          'G53 has no effect without axis words',
        );
      }
    }

    // Stop (M0, M1, M2, M30, M60).
    if (m.has('0') || m.has('60')) this.steps.push({ kind: 'pause', line: n, optional: false });
    if (m.has('1')) this.steps.push({ kind: 'pause', line: n, optional: true });
    if (m.has('2')) this.end(n, 'M2');
    if (m.has('30')) this.end(n, 'M30');

    for (const w of words) {
      if (!used.has(w.letter)) {
        this.report(
          n,
          'warning',
          'SEMANTIC_UNUSED_WORD',
          `"${w.letter}${w.value}" has no effect on this line`,
          w.span,
        );
      }
    }
  }

  // ── Motion ──────────────────────────────────────────────────────────────

  private move(
    n: number,
    words: readonly Word[],
    g53: boolean,
    used: { add(l: string): void },
  ): void {
    if (this.motion === 'G80') {
      this.report(
        n,
        'error',
        'SEMANTIC_AXIS_WORDS_WITHOUT_MOTION',
        'Axis words with G80 (no motion mode); line not run',
      );
      return;
    }
    if (g53 && (this.motion === 'G2' || this.motion === 'G3')) {
      this.report(
        n,
        'error',
        'SEMANTIC_G53_WITH_ARC',
        'G53 can only be used with G0 or G1; line not run',
      );
      return;
    }
    if (g53 && this.distance === 'incremental') {
      this.report(
        n,
        'error',
        'SEMANTIC_G53_INCREMENTAL',
        'G53 cannot be used in incremental mode (G91); line not run',
      );
      return;
    }
    const target = this.target(words, g53);
    const offset = this.offset();
    const from = this.position;

    if (this.motion === 'G0') {
      this.steps.push({
        kind: 'linear',
        line: n,
        rapid: true,
        from,
        to: target,
        feed: null,
        offset,
      });
      this.position = target;
      return;
    }
    const feed = this.feed(n, words);
    if (!feed) return;
    if (this.motion === 'G1') {
      this.steps.push({ kind: 'linear', line: n, rapid: false, from, to: target, feed, offset });
      this.position = target;
      return;
    }

    // G2/G3: the arc is described here, and resolved and validated by the geometry layer (2d).
    const [a1, a2] = PLANE_AXES[this.plane];
    const r = words.find((w) => w.letter === 'R');
    const offsetLetters = [a1, a2].map((a) => OFFSET_LETTER[a]);
    const centreWords = words.filter((w) => offsetLetters.includes(w.letter));
    const wrongOffset = words.filter(
      (w) => 'IJK'.includes(w.letter) && !offsetLetters.includes(w.letter),
    );
    for (const w of wrongOffset) {
      this.report(
        n,
        'warning',
        'SEMANTIC_OFFSET_NOT_IN_PLANE',
        `${w.letter} is not a centre offset in the ${this.plane} plane; ignored`,
        w.span,
      );
    }
    if (r && centreWords.length > 0) {
      this.report(
        n,
        'error',
        'SEMANTIC_ARC_R_AND_IJK',
        'An arc cannot use both R and centre offsets; line not run',
      );
      return;
    }
    if (!r && centreWords.length === 0) {
      this.report(
        n,
        'error',
        'SEMANTIC_ARC_NO_CENTRE',
        `Arc needs R or ${offsetLetters.join('/')} centre offsets; line not run`,
      );
      return;
    }
    const p = words.find((w) => w.letter === 'P');
    let turns = 1;
    if (p) {
      used.add('P');
      if (!Number.isInteger(p.value) || p.value < 1) {
        this.report(
          n,
          'error',
          'SEMANTIC_ARC_TURNS',
          'P (turns) must be a positive integer; line not run',
          p.span,
        );
        return;
      }
      turns = p.value;
    }
    const u = this.units === 'inch' ? 25.4 : 1;
    let centre: Position | null = null;
    if (!r) {
      for (const w of centreWords) used.add(w.letter);
      const c: Record<Axis, number> = { ...from };
      for (const a of [a1, a2]) {
        const w = centreWords.find((x) => x.letter === OFFSET_LETTER[a]);
        const v = (w?.value ?? 0) * u;
        c[a] = this.arcDistance === 'incremental' ? from[a] + v : v + offset[a];
      }
      centre = c;
    } else {
      used.add('R');
      const inPlane = words.some((w) => w.letter === a1 || w.letter === a2);
      if (!inPlane) {
        this.report(
          n,
          'error',
          'SEMANTIC_ARC_R_FULL_CIRCLE',
          `A radius-format arc needs ${a1} or ${a2}: a full circle can't be given by R; line not run`,
        );
        return;
      }
    }
    this.steps.push({
      kind: 'arc',
      line: n,
      from,
      to: target,
      plane: this.plane,
      clockwise: this.motion === 'G2',
      centre,
      radius: r ? r.value * u : null,
      turns,
      feed,
      offset,
    });
    this.position = target;
  }

  /**
   * A canned-cycle block (G73/G81/G82/G83, XY plane): resolve the values the way
   * LinuxCNC's convert_cycle_xy does, then emit the motions from cycleOps (ADR-0020).
   */
  private cycle(
    n: number,
    words: readonly Word[],
    prior: ModalState['motion'],
    used: { add(l: string): void },
  ): void {
    const code = this.motion as CycleCode;
    const same = prior === code;
    const fail = (c: string, m: string) => this.report(n, 'error', c, `${m}; line not run`);
    const get = (l: string) => words.find((w) => w.letter === l);
    if (this.plane !== 'XY')
      return fail('SEMANTIC_CYCLE_PLANE', 'Canned cycles are supported in the XY plane (G17) only');
    if (this.feedMode === 'inverse-time')
      return fail(
        'SEMANTIC_CYCLE_INVERSE_TIME',
        'Canned cycles cannot run in inverse-time feed (G93)',
      );
    if (this.cutterComp !== 'off')
      return fail(
        'SEMANTIC_CYCLE_CUTTER_COMP',
        'Canned cycles cannot run with cutter compensation on',
      );
    if (this.feedRate === null || this.feedRate <= 0)
      return fail('SEMANTIC_NO_FEED_RATE', 'Canned cycle with no feed rate set');
    for (const l of ['A', 'B', 'C'])
      if (get(l))
        return fail('SEMANTIC_CYCLE_ROTARY', 'Rotary axis words cannot be used in a canned cycle');

    const u = this.units === 'inch' ? 25.4 : 1;
    const rw = get('R');
    const r0 = rw ? rw.value * u : same ? this.cycleR : null;
    if (r0 === null)
      return fail('SEMANTIC_CYCLE_NO_R', `${code} needs an R (retract plane) on its first line`);
    const zw = get('Z');
    const z0 = zw ? zw.value * u : same ? this.cycleZ : null;
    if (z0 === null)
      return fail('SEMANTIC_CYCLE_NO_Z', `${code} needs a Z (hole bottom) on its first line`);
    let q: number | null = null;
    if (code === 'G73' || code === 'G83') {
      const qw = get('Q');
      q = qw ? qw.value * u : same ? this.cycleQ : null;
      if (q === null)
        return fail('SEMANTIC_CYCLE_NO_Q', `${code} needs a Q (peck depth) on its first line`);
      if (q <= 0) return fail('SEMANTIC_CYCLE_BAD_Q', 'Q (peck depth) must be positive');
    }
    let p: number | null = null;
    if (code === 'G82') {
      const pw = get('P');
      p = pw ? this.dwellSeconds(pw.value) : same ? this.cycleP : null;
      if (p === null) return fail('SEMANTIC_CYCLE_NO_P', 'G82 needs a P (dwell) on its first line');
      if (p < 0) return fail('SEMANTIC_NEGATIVE_DWELL', 'Dwell time cannot be negative');
    }
    const rep = get(this.behaviour.cycleRepeat.letter);
    const repeats = rep ? rep.value : 1;
    if (!Number.isInteger(repeats) || repeats < 1) {
      return fail(
        'SEMANTIC_CYCLE_REPEAT',
        `${this.behaviour.cycleRepeat.letter} (repeats) must be a positive integer`,
      );
    }

    const pos = this.position;
    const offset = this.offset();
    if (this.cycleInitial === null) this.cycleInitial = pos.Z;
    let initial = this.cycleInitial;
    const incremental = this.distance === 'incremental';
    const x = get('X');
    const y = get('Y');
    // G90: R and Z are work Z levels. G91: R is relative to the initial level, and Z to R.
    const r = incremental ? initial + r0 : r0 + offset.Z;
    const bottom = incremental ? r + z0 : z0 + offset.Z;
    if (r < bottom)
      return fail('SEMANTIC_CYCLE_R_BELOW_Z', 'R (retract plane) is below Z (hole bottom)');

    const holes: { x: number; y: number }[] = [];
    let hx = pos.X;
    let hy = pos.Y;
    for (let k = 0; k < repeats; k++) {
      if (incremental) {
        if (k === 0 || this.behaviour.cycleRepeat.stepInIncremental) {
          hx += x ? x.value * u : 0;
          hy += y ? y.value * u : 0;
        }
      } else {
        hx = x ? x.value * u + offset.X : pos.X;
        hy = y ? y.value * u + offset.Y : pos.Y;
      }
      holes.push({ x: hx, y: hy });
    }

    // Preliminary motion: from below R, rise to R once (convert_cycle_xy).
    let zNow = pos.Z;
    const steps: Step[] = [];
    const at = (px: number, py: number, pz: number): Position => ({ ...pos, X: px, Y: py, Z: pz });
    let from: Position = pos;
    const feed: Feed = { mode: 'per-minute', mmPerMinute: this.feedRate };
    if (initial < r) {
      const to = at(pos.X, pos.Y, r);
      steps.push({ kind: 'linear', line: n, rapid: true, from, to, feed: null, offset });
      from = to;
      zNow = r;
      initial = r;
    }
    const clear = this.retract === 'r-plane' ? r : initial;
    for (const op of cycleOps({
      code,
      x: from.X,
      y: from.Y,
      z: zNow,
      holes,
      r,
      bottom,
      clear,
      ...(q !== null ? { peck: q } : {}),
      ...(p !== null ? { dwellSeconds: p } : {}),
      g73Retract: this.behaviour.g73Retract,
      g83Clearance: this.behaviour.g83Clearance,
    })) {
      if (op.kind === 'dwell') {
        steps.push({ kind: 'dwell', line: n, seconds: op.seconds });
        continue;
      }
      const to = at(op.x, op.y, op.z);
      steps.push({
        kind: 'linear',
        line: n,
        rapid: op.kind === 'rapid',
        from,
        to,
        feed: op.kind === 'feed' ? feed : null,
        offset,
      });
      from = to;
    }
    this.steps.push(...steps);
    this.position = from;
    this.cycleR = r0;
    this.cycleZ = z0;
    if (q !== null) this.cycleQ = q;
    if (p !== null) this.cycleP = p;
    for (const l of ['X', 'Y', 'Z', 'R', 'Q', 'P', this.behaviour.cycleRepeat.letter]) used.add(l);
  }

  /** A P dwell value in seconds, per the dialect's dwell units. */
  private dwellSeconds(p: number): number {
    return this.behaviour.dwellUnits === 'milliseconds' ? p / 1000 : p;
  }

  /** Target machine position from the line's axis words. */
  private target(words: readonly Word[], g53: boolean): Position {
    const out: Record<Axis, number> = { ...this.position };
    const offset = this.offset();
    const u = this.units === 'inch' ? 25.4 : 1;
    for (const w of words) {
      if (!(w.letter in AXIS_INDEX)) continue;
      const a = w.letter as Axis;
      const v = LINEAR.has(a) ? w.value * u : w.value;
      if (g53) out[a] = v;
      else if (this.distance === 'incremental') out[a] = this.position[a] + v;
      else out[a] = v + offset[a];
    }
    return out;
  }

  private feed(n: number, words: readonly Word[]): Feed | null {
    const hasF = words.some((w) => w.letter === 'F');
    if (this.feedMode === 'inverse-time') {
      if (!hasF || this.feedRate === null || this.feedRate <= 0) {
        this.report(
          n,
          'error',
          'SEMANTIC_NO_FEED_RATE',
          'Inverse-time mode (G93) needs an F word on every feed move; line not run',
        );
        return null;
      }
      return { mode: 'inverse-time', perMinute: this.feedRate };
    }
    if (this.feedRate === null || this.feedRate <= 0) {
      // Upstream silently used 200 mm/min (N10). A real controller refuses.
      this.report(
        n,
        'error',
        'SEMANTIC_NO_FEED_RATE',
        'Feed move with no feed rate set (no F word yet); line not run',
      );
      return null;
    }
    return this.feedMode === 'per-minute'
      ? { mode: 'per-minute', mmPerMinute: this.feedRate }
      : { mode: 'per-revolution', mmPerRevolution: this.feedRate };
  }

  // ── Offsets and homes (in LinuxCNC's parameter layout, millimetres) ─────

  private coordinateSystem(): number {
    return this.numbered.get(5220) ?? 1;
  }

  private wcsBase(cs: number): number {
    return 5221 + 20 * (cs - 1);
  }

  /** Writes a parameter; any write in the offset range (#5210-#5390) invalidates the cached offset. */
  private setParam(i: number, v: number): void {
    this.numbered.set(i, v);
    if (i >= 5210 && i <= 5390) this.offsetCache = null;
  }

  private offset(): Position {
    if (this.offsetCache) return this.offsetCache;
    const base = this.wcsBase(this.coordinateSystem());
    const g92On = (this.numbered.get(5210) ?? 0) !== 0;
    const o = {} as Record<Axis, number>;
    for (const a of AXES) {
      const i = AXIS_INDEX[a];
      o[a] = (this.numbered.get(base + i) ?? 0) + (g92On ? (this.numbered.get(5211 + i) ?? 0) : 0);
    }
    this.offsetCache = o;
    return o;
  }

  private axisValue(w: Word): number {
    return LINEAR.has(w.letter as Axis) && this.units === 'inch' ? w.value * 25.4 : w.value;
  }

  private g10(n: number, words: readonly Word[]): void {
    const l = words.find((w) => w.letter === 'L');
    const p = words.find((w) => w.letter === 'P');
    if (!l || (l.value !== 2 && l.value !== 20)) {
      this.report(
        n,
        'error',
        'SEMANTIC_G10_FORM',
        'Only G10 L2 and G10 L20 (coordinate system data) are supported',
      );
      return;
    }
    const cs = p ? Math.round(p.value) : NaN;
    if (!(cs >= 0 && cs <= 9)) {
      this.report(
        n,
        'error',
        'SEMANTIC_G10_P',
        'G10 needs P0-P9 (P0 is the active coordinate system)',
      );
      return;
    }
    if (words.some((w) => w.letter === 'R')) {
      this.report(
        n,
        'warning',
        'SEMANTIC_ROTATION_NOT_SUPPORTED',
        'Coordinate system rotation (R) is not simulated; ignored',
      );
    }
    const base = this.wcsBase(cs === 0 ? this.coordinateSystem() : cs);
    const current = this.offset();
    const g92 = this.subtract(current, this.wcsOffsetOf(this.coordinateSystem()));
    for (const w of words) {
      if (!(w.letter in AXIS_INDEX)) continue;
      const a = w.letter as Axis;
      const v = this.axisValue(w);
      // L2: the offset itself. L20: the offset that makes the current position read v.
      const value = l.value === 2 ? v : this.position[a] - g92[a] - v;
      this.setParam(base + AXIS_INDEX[a], value);
    }
  }

  private wcsOffsetOf(cs: number): Position {
    const base = this.wcsBase(cs);
    const o = {} as Record<Axis, number>;
    for (const a of AXES) o[a] = this.numbered.get(base + AXIS_INDEX[a]) ?? 0;
    return o;
  }

  private subtract(p: Position, q: Position): Position {
    const o = {} as Record<Axis, number>;
    for (const a of AXES) o[a] = p[a] - q[a];
    return o;
  }

  private g92(words: readonly Word[]): void {
    const wcs = this.wcsOffsetOf(this.coordinateSystem());
    const on = (this.numbered.get(5210) ?? 0) !== 0;
    for (const a of AXES) if (!on) this.setParam(5211 + AXIS_INDEX[a], 0);
    for (const w of words) {
      if (!(w.letter in AXIS_INDEX)) continue;
      const a = w.letter as Axis;
      this.setParam(5211 + AXIS_INDEX[a], this.position[a] - wcs[a] - this.axisValue(w));
    }
    this.setParam(5210, 1);
  }

  private g52(words: readonly Word[]): void {
    const on = (this.numbered.get(5210) ?? 0) !== 0;
    for (const a of AXES) if (!on) this.setParam(5211 + AXIS_INDEX[a], 0);
    for (const w of words) {
      if (w.letter in AXIS_INDEX)
        this.setParam(5211 + AXIS_INDEX[w.letter as Axis], this.axisValue(w));
    }
    this.setParam(5210, 1);
  }

  private storeHome(base: number): void {
    for (const a of AXES) this.setParam(base + AXIS_INDEX[a], this.position[a]);
  }

  /** G28/G30: rapid to an optional intermediate point, then to the stored position. */
  private home(n: number, base: number, words: readonly Word[]): void {
    const axisWords = words.filter((w) => w.letter in AXIS_INDEX);
    const stored = AXES.some((a) => this.numbered.has(base + AXIS_INDEX[a]));
    if (!stored) {
      this.reportOnce(
        n,
        'info',
        `SEMANTIC_HOME_UNSET_${base}`,
        `G${base === 5161 ? 28 : 30} goes to its stored position, which this program never set: using the machine origin`,
      );
    }
    const offset = this.offset();
    if (axisWords.length > 0) {
      const via = this.target(words, false);
      this.steps.push({
        kind: 'linear',
        line: n,
        rapid: true,
        from: this.position,
        to: via,
        feed: null,
        offset,
      });
      this.position = via;
    }
    const to: Record<Axis, number> = { ...this.position };
    const axes = axisWords.length > 0 ? axisWords.map((w) => w.letter as Axis) : [...AXES];
    for (const a of axes) to[a] = this.numbered.get(base + AXIS_INDEX[a]) ?? 0;
    this.steps.push({
      kind: 'linear',
      line: n,
      rapid: true,
      from: { ...this.position },
      to,
      feed: null,
      offset,
    });
    this.position = to;
  }

  // ── Parameters ──────────────────────────────────────────────────────────

  private value(line: Line, v: Value): number | null {
    if (v.kind === 'number') return v.value;
    const parsed = parseExpression(line.text, v.span, line.lineNo, this.rules);
    this.diagnostics.push(...parsed.diagnostics);
    if (!parsed.expr) return null;
    const r = evaluate(parsed.expr, this.params, this.rules, line.lineNo);
    this.diagnostics.push(...r.diagnostics);
    return r.value;
  }

  /** Assignments take effect after the whole line (RS274/NGC; LinuxCNC "Numbered Parameters"). */
  private assign(line: Line, target: string, value: number): void {
    const t = target.replace(/[ \t]/g, '');
    const nameMatch = /^#<(.*)>$/.exec(t);
    if (nameMatch) {
      this.named.set((nameMatch[1] ?? '').toLowerCase(), value);
      return;
    }
    // #n, #[expr] or ##n: evaluate the index expression (without the leading #).
    const indexSrc = t.slice(1);
    const parsed = parseExpression(
      indexSrc,
      { start: 0, end: indexSrc.length },
      line.lineNo,
      this.rules,
    );
    const idx = parsed.expr
      ? evaluate(parsed.expr, this.params, this.rules, line.lineNo).value
      : null;
    if (idx === null || !Number.isInteger(idx) || idx < 1 || idx > this.rules.maxParameter) {
      this.report(line.lineNo, 'error', 'SEMANTIC_BAD_ASSIGNMENT', `Cannot assign to ${target}`);
      return;
    }
    this.setParam(idx, value);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private end(n: number, by: 'M2' | 'M30' | '%'): void {
    this.steps.push({ kind: 'end', line: n, by });
    this.ended = true;
  }

  private report(
    line: number,
    severity: Severity,
    code: string,
    message: string,
    span?: Span,
  ): void {
    this.diagnostics.push(
      span ? { severity, code, message, line, span } : { severity, code, message, line },
    );
  }

  private reportOnce(line: number, severity: Severity, code: string, message: string): void {
    if (this.once.has(code)) return;
    this.once.add(code);
    this.report(line, severity, code, message);
  }

  private state(): ModalState {
    return {
      motion: this.motion,
      plane: this.plane,
      units: this.units,
      distance: this.distance,
      arcDistance: this.arcDistance,
      feedMode: this.feedMode,
      coordinateSystem: this.coordinateSystem(),
      cutterCompensation: this.cutterComp,
      toolLengthOffset: this.toolLength,
      retract: this.retract,
      pathControl: this.pathControl,
      position: { ...this.position },
      feedRate: this.feedRate,
      spindle: { ...this.spindle },
      tool: this.tool,
    };
  }
}
