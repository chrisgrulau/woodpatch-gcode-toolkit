// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { LINUXCNC_ARC_TOLERANCE, type ArcTolerance } from './arcs.js';

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

/** LinuxCNC's behaviour, verified against its source (reviewer, toolkit #10). */
export const LINUXCNC_INTERPRETER_RULES: InterpreterRules = Object.freeze({
  feedUnits: 'at-feed-step',
  dwellUnits: 'seconds',
  cycleRepeat: Object.freeze({ letter: 'L', stepInIncremental: true }),
  // interp_cycles.cc: parameter_g73_peck_clearance / parameter_g83_peck_clearance,
  // documented as 0.010 in / 0.254 mm.
  g73Retract: 0.254,
  g83Clearance: 0.254,
  subprograms: Object.freeze({ oWord: true, m98: 'in-file', maxCallDepth: 9 }),
  arcTolerance: LINUXCNC_ARC_TOLERANCE,
});
