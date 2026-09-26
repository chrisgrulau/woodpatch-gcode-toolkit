// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { LINUXCNC_ARC_TOLERANCE, type ArcTolerance } from './arcs.js';
import { LINUXCNC_G, LINUXCNC_M } from './codes.js';

/**
 * Interpreter behaviour that genuinely varies between controllers, as data
 * (ADR-0019), in the same spirit as the expression rules (ADR-0018). Dialect
 * profiles (parcel 2e) choose a set.
 */
export interface InterpreterRules {
  /**
   * The units of an F word on a line that also switches G20/G21.
   * - `at-feed-step`: F is read in the units in force BEFORE the line's G20/G21.
   *   That's RS274's order of execution (F at step 3, units at step 12), and what
   *   LinuxCNC does (`execute_block` runs `convert_feed_rate` before
   *   `convert_length_units`). `G20 G1 X1 F10` from G21 feeds at 10 mm/min.
   * - `end-of-line`: F is read in the units the line ends in; the same line feeds at
   *   10 in/min.
   * Either way, such a line gets a warning, because it means different things on
   * different controllers.
   */
  readonly feedUnits: 'at-feed-step' | 'end-of-line';
  /** Units of the P word of G4 and G82. LinuxCNC: seconds. Masso: milliseconds. */
  readonly dwellUnits: 'seconds' | 'milliseconds';
  /**
   * Canned-cycle repeats. LinuxCNC: `L`, and under G91 each repeat steps X/Y by the
   * programmed increment. Masso: `K`, repeated at the same position.
   */
  readonly cycleRepeat: { readonly letter: 'L' | 'K'; readonly stepInIncremental: boolean };
  /** G73 back-off after each peck, in mm. LinuxCNC: 0.254 (0.010 in). Masso: 1.0. */
  readonly g73Retract: number;
  /** G83: how far above the last peck the rapid descent stops, in mm. LinuxCNC: 0.254. */
  readonly g83Clearance: number;
  /** Subprograms and program flow (parcel 2c-3, ADR-0021). */
  readonly subprograms: SubprogramRules;
  /**
   * How far an arc's geometry may be off before the line is refused (ADR-0022).
   * LinuxCNC: 0.028 mm of radius mismatch. Masso accepted 0.5 mm in the 2026-09-26
   * machine test; its limit is not known yet.
   */
  readonly arcTolerance: ArcTolerance;
  /**
   * The G and M codes the controller accepts (parcel 2e-1, ADR-0023). A code outside
   * the list is "not supported; line not run", which is what Masso does (its docs,
   * and machine test T8). `later` marks codes the controller has but this
   * interpreter doesn't model yet, with the reason. null: every code known here.
   */
  readonly codes: {
    readonly g: readonly string[];
    readonly m: readonly string[];
    readonly later?: Readonly<Record<string, string>>;
  } | null;
  /** Whether expressions and parameters exist (#1, [1+2], SIN[30]). Masso: no (T10-T14). */
  readonly parameters: boolean;
  /**
   * `/` at the start of a line. `switch`: the block-delete switch decides (LinuxCNC).
   * `ignored`: the `/` means nothing and the line runs (Masso, machine test T7).
   */
  readonly blockDelete: 'switch' | 'ignored';
  /** Operator messages: Masso `MSG text` lines; LinuxCNC `(MSG, text)` comments. */
  readonly messages: { readonly lines: boolean; readonly comments: boolean };
  /**
   * A feed move before any F. `error` (LinuxCNC). `machine-rate`: it runs at the
   * operator's percentage of the maximum rate, so its time is unknown (Masso, T1).
   */
  readonly missingFeed: 'error' | 'machine-rate';
  /**
   * After G80. `error`: axis words with no motion mode are an error (LinuxCNC).
   * `rapid`: G80 returns to G0 (Masso docs; machine test T9 moved at rapid).
   */
  readonly afterG80: 'error' | 'rapid';
  /**
   * Changing from one canned cycle to another without G80. Masso's docs say G80 must
   * come first; what the machine does otherwise is untested, so it's a warning.
   */
  readonly cycleSwitch: 'allowed' | 'warn';
}

export interface SubprogramRules {
  /** LinuxCNC O-word flow: `sub`/`call`, `if`, `while`, `do`, `repeat`. Masso: none. */
  readonly oWord: boolean;
  /**
   * Where `M98 P<n>` finds subprogram n.
   * - `file`: a separate file named n (Masso: `n.nc` in the same folder), ended by M99.
   * - `in-file`: an `O<n>` block later in the same file (LinuxCNC's Fanuc-style
   *   numbered programs). Not interpreted yet: such lines are reported and not run.
   */
  readonly m98: 'file' | 'in-file';
  /**
   * The deepest nesting of calls below the main program that the controller allows.
   * A deeper call is an error: the program would fail on the machine.
   * LinuxCNC: 9 (`INTERP_SUB_ROUTINE_LEVELS` is 10 and counts the main program;
   * `enter_context` refuses when `call_level + 1 >= 10`). Masso: 5 (documented).
   */
  readonly maxCallDepth: number;
}

/**
 * LinuxCNC 2.9 (stable) behaviour, verified against its source (reviewer, toolkit #10
 * and #11). Every rule here is the same on master unless ADR-0020 says otherwise.
 */
export const LINUXCNC_INTERPRETER_RULES: InterpreterRules = Object.freeze({
  feedUnits: 'at-feed-step',
  dwellUnits: 'seconds',
  cycleRepeat: Object.freeze({ letter: 'L', stepInIncremental: true }),
  // LinuxCNC 2.9 interp_cycles.cc: G83_RAPID_DELTA (0.010 in, x25.4 under G21) for
  // both G73 and G83. 2.10 changes this (ADR-0020): see the note there before adding
  // a 2.10 profile.
  g73Retract: 0.254,
  g83Clearance: 0.254,
  subprograms: Object.freeze({ oWord: true, m98: 'in-file', maxCallDepth: 9 }),
  arcTolerance: LINUXCNC_ARC_TOLERANCE,
  codes: Object.freeze({ g: LINUXCNC_G, m: LINUXCNC_M }),
  parameters: true,
  blockDelete: 'switch',
  messages: Object.freeze({ lines: false, comments: true }),
  missingFeed: 'error',
  afterG80: 'error',
  cycleSwitch: 'allowed',
});
