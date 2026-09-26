// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  G_CODES,
  GENERIC,
  LINUXCNC,
  MASSO_G3,
  M_CODES,
  interpret,
  parse,
  type InterpretOptions,
  type Step,
} from '../index.js';

// Parcel 2e-1 (ADR-0023): dialect profiles.

const run = (src: string, options?: InterpretOptions) => interpret(parse(src), options);
const masso = { dialect: MASSO_G3 };
const moves = (steps: readonly Step[]) =>
  steps.flatMap((s) => (s.kind === 'linear' || s.kind === 'arc' ? [s] : []));
const xs = (src: string, options?: InterpretOptions) =>
  moves(run(src, options).steps).map((s) => s.to.X);
const codes = (src: string, options?: InterpretOptions) =>
  run(src, options).diagnostics.map((d) => d.code);
const codesOf = codes;

describe('the Masso machine test, replayed (2026-09-26, v5.13)', () => {
  // The program Chris ran on the router, byte for byte, and the work DRO readings he
  // recorded at each stop. The DRO steps in about 0.005 mm (0.0047 mm per motor step),
  // so readings like 9.998 are compared to within 0.01 mm.
  const src = readFileSync(
    new URL('../../../../fixtures/machine/masso-dialect-test-v1.nc', import.meta.url),
    'utf8',
  );
  const result = run(src, masso);

  // Where the tool is at each M00 stop, after the first (the "cycle start" stop).
  const stops: { x: number; y: number; z: number; line: number }[] = [];
  let at = { X: 0, Y: 0, Z: 0 };
  for (const s of result.steps) {
    if (s.kind === 'linear' || s.kind === 'arc') at = s.to;
    if (s.kind === 'pause') stops.push({ x: at.X, y: at.Y, z: at.Z, line: s.line });
  }
  const recorded: Record<string, [number, number]> = {
    T1: [5, 0],
    T2: [9.998, 0],
    T3: [15, 0],
    T4: [0.502, 6.998],
    T5: [12, 0.005],
    T6: [0, 0.005],
    T7: [20.002, 0.005],
    T8: [0, 0.005],
    T9: [20.002, 0.005],
    T10: [0, 0.005],
    T11: [0, 0.005],
    T12: [0, 0.005],
    T13: [0, 0.005],
    T14: [0, 0.005],
    T15: [9.998, 0],
    T16: [0, 9.998],
    T17: [-10.5, 0],
  };

  it.each(Object.entries(recorded))('%s stops where the machine did', (test, [x, y]) => {
    const k = Number(test.slice(1)); // stop 0 is the "cycle start" stop
    const stop = stops[k];
    expect(stop).toBeDefined();
    expect(Math.abs((stop?.x ?? NaN) - x)).toBeLessThan(0.01);
    expect(Math.abs((stop?.y ?? NaN) - y)).toBeLessThan(0.01);
  });

  it('T15-T16: draws the full circle and the 3/4 circle the machine cut', () => {
    const arcs = result.steps.flatMap((s) => (s.kind === 'arc' ? [s] : []));
    expect(arcs[0]?.sweep).toBeCloseTo(-2 * Math.PI, 12);
    expect(arcs[1]?.sweep).toBeCloseTo((-3 * Math.PI) / 2, 12);
    // T17's 0.5 mm radius mismatch is accepted, as the machine did.
    expect(arcs[2]).toMatchObject({ radius: 10, endRadius: 10.5 });
  });

  it('T18: G83 retracts to R (Z6) between pecks and ends at the initial Z9 (G98)', () => {
    const line = src.split('\n').findIndex((l) => l.startsWith('G98 G83')) + 1;
    const zs = moves(result.steps)
      .filter((s) => s.line === line)
      .map((s) => s.to.Z);
    expect(zs.filter((z) => z === 6).length).toBeGreaterThan(1);
    expect(zs.at(-1)).toBe(9);
  });

  it('shows the MSG lines as messages, and says why each skipped line was skipped', () => {
    const messages = result.steps.flatMap((s) => (s.kind === 'message' ? [s.text] : []));
    expect(messages[0]).toBe('DIALECT TEST - CYCLE START');
    expect(messages).toContain('TEST COMPLETE - THANK YOU');
    const why = result.diagnostics.map((d) => d.code);
    expect(why).toContain('SEMANTIC_FEED_UNSPECIFIED'); // T1
    expect(why).toContain('SEMANTIC_REPEATED_WORD'); // T6
    expect(why).toContain('SEMANTIC_BLOCK_DELETE_IGNORED'); // T7
    expect(why).toContain('SEMANTIC_UNSUPPORTED_CODE'); // T8: G64
    expect(why.filter((c) => c === 'SEMANTIC_PARAMETERS_UNSUPPORTED')).toHaveLength(6); // T10-T14
  });

  it('marks the T1 move as feed-unknown, so time estimates cannot pretend', () => {
    const t1 = moves(result.steps).find((s) => s.kind === 'linear' && !s.rapid);
    expect(t1).toMatchObject({ feed: { mode: 'unspecified' } });
  });
});

describe('Masso rules', () => {
  it('ignores a whole line with a code Masso lacks, e.g. G43 from a generic CAM post', () => {
    expect(xs('G0 Z5\nG0 G43 Z15 H1\nG0 X1', masso)).toEqual([0, 1]);
    expect(codes('G0 G43 Z15 H1', masso)).toEqual(['SEMANTIC_UNSUPPORTED_CODE']);
    // LinuxCNC has G43: the move runs.
    expect(xs('G0 G43 Z15 H1\nG0 X1', { dialect: LINUXCNC })).toEqual([0, 1]);
  });

  it('dwells in milliseconds, repeats with K at the same position, backs off 1 mm on G73', () => {
    const dwell = run('G4 P1500', masso).steps[0];
    expect(dwell).toMatchObject({ kind: 'dwell', seconds: 1.5 });
    const k = moves(run('G0 Z5\nG91 G81 X10 Z-2 R-3 K2 F100', masso).steps);
    expect(new Set(k.filter((s) => s.line === 2).map((s) => s.to.X))).toEqual(new Set([10]));
    // Two holes: two feeds down to the bottom.
    expect(k.filter((s) => s.kind === 'linear' && !s.rapid)).toHaveLength(2);
    const g73 = moves(run('G0 Z5\nG98 G73 X0 Z-3 R1 Q1 F100', masso).steps).map((s) => s.to.Z);
    expect(g73).toContain(1); // back off 1 mm from the first peck at 0
  });

  it('moves at rapid after G80, including on the G80 line itself', () => {
    const r = run('G1 F100 X1\nG80\nX20', masso);
    expect(moves(r.steps).at(-1)).toMatchObject({ kind: 'linear', rapid: true });
    expect(r.state.motion).toBe('G0');
    expect(codes('G80\nX20', { dialect: LINUXCNC })).toEqual([
      'SEMANTIC_AXIS_WORDS_WITHOUT_MOTION',
    ]);
  });

  it('warns on a change of canned cycle without G80', () => {
    expect(codes('G0 Z5\nG81 X1 Z-1 R1 F100\nG83 X2 Z-1 R1 Q1', masso)).toContain(
      'SEMANTIC_CYCLE_SWITCH_WITHOUT_G80',
    );
    expect(codes('G0 Z5\nG81 X1 Z-1 R1 F100\nG83 X2 Z-1 R1 Q1', { dialect: LINUXCNC })).toEqual([]);
  });

  it('reads MSG after an N word, clears on a bare MSG, and knows MSG_W/MSG_SW', () => {
    const steps = run('N10 MSG Load Material\nN30 MSG\nMSG_W to phone\nMSG_SW both', masso).steps;
    expect(steps).toEqual([
      { kind: 'message', line: 1, text: 'Load Material', target: 'screen' },
      { kind: 'message', line: 2, text: '', target: 'screen' },
      { kind: 'message', line: 3, text: 'to phone', target: 'workshop' },
      { kind: 'message', line: 4, text: 'both', target: 'both' },
    ]);
  });
});

describe('LinuxCNC and generic', () => {
  it('LinuxCNC shows (MSG, …) comments and warns about Masso MSG lines', () => {
    const r = run('G0 X1 (MSG, Check the clamp)\nMSG hello', { dialect: LINUXCNC });
    expect(r.steps.find((s) => s.kind === 'message')).toMatchObject({ text: 'Check the clamp' });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_MSG_NOT_SUPPORTED']);
    expect(xs('G0 X1 (MSG, Check the clamp)', { dialect: LINUXCNC })).toEqual([1]);
  });

  it('LinuxCNC refuses a Masso-only code; generic accepts every code known here', () => {
    expect(codes('G54.1 P1', { dialect: LINUXCNC })).toEqual(['SEMANTIC_UNSUPPORTED_CODE']);
    expect(codes('G54.1 P1', { dialect: GENERIC })).toEqual([]);
    expect(codes('G68 R45', { dialect: GENERIC })).toEqual(['SEMANTIC_NOT_YET_SUPPORTED']);
  });

  it('defaults to LinuxCNC when no dialect is given', () => {
    expect(run('G0 X1').steps).toEqual(run('G0 X1', { dialect: LINUXCNC }).steps);
    expect(codes('G1 X1')).toEqual(['SEMANTIC_NO_FEED_RATE']);
  });
});

describe('Masso positions and events (parcel 2e-2)', () => {
  const ends = (src: string, options: InterpretOptions = masso) =>
    moves(run(src, options).steps).map((s) => [s.to.X, s.to.Y, s.to.Z]);

  it('G28 goes to machine home, Z first, then the other axes together', () => {
    expect(ends('G0 X100 Y50 Z-5\nG28')).toEqual([
      [100, 50, -5],
      [100, 50, 0],
      [0, 0, 0],
    ]);
    // A machine whose home isn't the origin.
    const opts = { ...masso, machine: { home: { X: 1600, Y: 0, Z: 0 } } };
    expect(ends('G0 X100 Y50 Z-5\nG28', opts).at(-1)).toEqual([1600, 0, 0]);
  });

  it('G28 with axis words goes via that point, and only those axes go home (docs)', () => {
    // G90: via work X0 Y0 Z0 (G54 at X10 Y10), then only X, Y, Z home.
    const src = 'G10 L2 P1 X10 Y10\nG54\nG0 X5 Y5 Z-5\nG28 X0 Y0 Z0';
    // Machine (15,15,-5) → via work (0,0,0) = machine (10,10,0) → home. Z is
    // already at home, so only X and Y move.
    expect(ends(src).slice(-3)).toEqual([
      [15, 15, -5],
      [10, 10, 0],
      [0, 0, 0],
    ]);
    // G91 G28 Z8: up 8 first, then only Z goes home; X and Y stay.
    expect(ends('G0 X5 Y5 Z-10\nG91 G28 Z8\nG90').slice(-2)).toEqual([
      [5, 5, -2],
      [5, 5, 0],
    ]);
  });

  it('G30 goes to the parking position, Z first; unknown, it says so and does not move', () => {
    const opts = { ...masso, machine: { park: { X: 800, Y: 3900, Z: -20 } } };
    expect(ends('G0 X100 Y50 Z-5\nG30', opts).slice(-2)).toEqual([
      [100, 50, -20],
      [800, 3900, -20],
    ]);
    const r = run('G0 X1\nG30', masso);
    expect(moves(r.steps)).toHaveLength(1);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_PARK_UNKNOWN']);
  });

  it('G10: L2 sets, L2.1 adds to the active offset, L20 sets an extended offset (docs)', () => {
    const at = (src: string) => ends(`${src}\nG0 X0 Y0`).at(-1);
    expect(at('G10 L2 P1 X10 Y10\nG54')).toEqual([10, 10, 0]);
    // Active G54 is (10,10): L2.1 P2 X10 Y20 makes G55 (20,30).
    expect(at('G10 L2 P1 X10 Y10\nG54\nG10 L2.1 P2 X10 Y20\nG55')).toEqual([20, 30, 0]);
    expect(at('G10 L20 P50 X100 Y200\nG54.1 P50')).toEqual([100, 200, 0]);
    const r = run('G10 L20 P50 X100\nG54.1 P50', masso);
    expect(r.state.coordinateSystem).toBe(150);
    expect(codes('G54.1 P101', masso)).toEqual(['SEMANTIC_G54_1_P']);
    expect(codes('G10 L2 P7 X1', masso)).toEqual(['SEMANTIC_G10_P']);
  });

  it('keeps LinuxCNC\u2019s G10 L20 (make the current position read the value)', () => {
    const r = run('G0 X30\nG10 L20 P1 X10\nG0 X0', { dialect: LINUXCNC });
    expect(moves(r.steps).at(-1)?.to.X).toBe(20);
  });

  it('M66 waits for an input; its S skips lines, not a spindle speed', () => {
    const r = run('M3 S10000\nM66 P4 L3 Q1000 S2', masso);
    expect(r.steps.at(-1)).toEqual({
      kind: 'wait',
      line: 2,
      input: 4,
      timeoutSeconds: 1,
      skipLines: 2,
    });
    expect(r.state.spindle.rpm).toBe(10000);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_WAIT_MAY_SKIP']);
  });

  it('M6.1 unloads the tool', () => {
    const r = run('T5 M6\nM6.1', masso);
    expect(r.steps.at(-1)).toEqual({ kind: 'tool-change', line: 2, tool: null });
    expect(r.state.tool).toBeNull();
  });

  it('warns when T follows M06 on the line, or the spindle is still running', () => {
    expect(codes('M06 T5', masso)).toContain('SEMANTIC_TOOL_AFTER_M6');
    expect(codes('T5 M06', masso)).toEqual([]);
    expect(codes('M3 S1000\nT2 M6', masso)).toContain('SEMANTIC_M6_SPINDLE_ON');
    expect(codes('M3 S1000\nM5\nT2 M6', masso)).toEqual([]);
    expect(codes('M06 T5', { dialect: LINUXCNC })).toEqual([]);
  });

  it('suggests a dwell after a speed change while running, before the next feed move', () => {
    const advice = (src: string) =>
      run(src, masso).diagnostics.filter((d) => d.code === 'SEMANTIC_SPINDLE_NOT_SETTLED');
    // Changed while running, then straight into a cut: advised, at the S line.
    expect(advice('M3 S10000\nF500\nS16000\nG1 X10')).toMatchObject([{ line: 3 }]);
    // A rapid in between still needs it: the cut starts at the new speed's ramp.
    expect(advice('M3 S10000\nF500\nS16000\nG0 Z5\nG1 X10')).toHaveLength(1);
    // A dwell settles it; starting from stopped the controller waits itself.
    expect(advice('M3 S10000\nF500\nS16000\nG4 P2000\nG1 X10')).toEqual([]);
    expect(advice('F500\nS16000 M3\nG1 X10')).toEqual([]);
    expect(advice('M3 S10000\nF500\nS10000\nG1 X10')).toEqual([]);
    // Not a LinuxCNC concern here.
    expect(codes('M3 S10000\nF500\nS16000\nG1 X10', { dialect: LINUXCNC })).toEqual([]);
  });

  it('draws an arc beyond the tested 0.5 mm mismatch, with a warning, not a refusal', () => {
    const r = run('F100\nG0 X10\nG2 X-11 Y0 I-10 J0', masso);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_ARC_RADIUS_MISMATCH_UNTESTED']);
    expect(r.steps.at(-1)).toMatchObject({ kind: 'arc', endRadius: 11 });
  });
});

describe('Phase 2 acceptance: no Masso code is silently ignored', () => {
  it('knows every code in the Masso reference: each is interpreted or reported', () => {
    const codes = MASSO_G3.interpreter.codes;
    expect(codes).not.toBeNull();
    for (const g of codes?.g ?? []) expect(G_CODES.has(g), `G${g}`).toBe(true);
    for (const m of codes?.m ?? []) expect(M_CODES.has(m), `M${m}`).toBe(true);
    // None is refused as unknown; the ones not modelled say so.
    for (const [letter, list, table] of [
      ['G', codes?.g ?? [], G_CODES],
      ['M', codes?.m ?? [], M_CODES],
    ] as const) {
      for (const c of list) {
        const found = codesOf(`${letter}${c}`, masso);
        expect(found, `${letter}${c}`).not.toContain('SEMANTIC_UNSUPPORTED_CODE');
        if (table.get(c)?.later)
          expect(found, `${letter}${c}`).toContain('SEMANTIC_NOT_YET_SUPPORTED');
      }
    }
  });
});
