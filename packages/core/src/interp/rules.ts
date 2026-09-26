// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

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
}

/** LinuxCNC's behaviour, verified against its source (reviewer, toolkit #10). */
export const LINUXCNC_INTERPRETER_RULES: InterpreterRules = Object.freeze({
  feedUnits: 'at-feed-step',
});
