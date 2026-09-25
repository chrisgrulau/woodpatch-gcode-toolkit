// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * How a dialect evaluates expressions (ADR-0018).
 *
 * Controllers genuinely disagree here, and upstream webgcode matched none of them
 * on several points (ANALYSIS §3, N13), so every rule that varies is data rather
 * than code. Dialect profiles (parcel 2e) choose a set.
 */
export type BinaryOperator =
  | '**'
  | '*'
  | '/'
  | 'MOD'
  | '+'
  | '-'
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'
  | 'AND'
  | 'OR'
  | 'XOR';

export interface ExpressionRules {
  /** Operator precedence groups, highest first; left-associative within a group. */
  readonly precedence: readonly (readonly BinaryOperator[])[];
  /** Two values closer than this are equal for EQ, NE, GE and LE. 0 means exact. */
  readonly equalityTolerance: number;
  /** Units of trig function arguments (SIN, COS, TAN) and results (ASIN, ACOS, ATAN). */
  readonly angleUnit: 'degrees' | 'radians';
  /** `positive`: the result takes the sign of |divisor|, as in LinuxCNC. `truncated`: JavaScript `%`. */
  readonly mod: 'positive' | 'truncated';
  /** `half-away`: ROUND[-2.5] = -3 (LinuxCNC). `half-up`: ROUND[-2.5] = -2 (JavaScript Math.round). */
  readonly round: 'half-away' | 'half-up';
  /** Reading a named parameter that was never set. */
  readonly undefinedNamedParameter: 'error' | 'zero';
  /** Valid numbered parameters are 1 to this, inclusive. */
  readonly maxParameter: number;
  /** Maximum nesting of brackets and calls. Deeper input is a diagnostic, never a stack overflow (R1). */
  readonly maxDepth: number;
}

/**
 * LinuxCNC's rules, checked against its interpreter source
 * (`src/emc/rs274ngc/interp_execute.cc`, `interp_read.cc`, `interp_namedparams.cc`):
 * - five precedence levels;
 * - `TOLERANCE_EQUAL` = 1e-6;
 * - trig in degrees;
 * - MOD "always calculates a positive answer";
 * - ROUND rounds half away from zero;
 * - an undefined named parameter is an error;
 * - unary +/- may precede any value.
 * The generic default; RS274/NGC as most modern controllers implement it.
 */
export const LINUXCNC_RULES: ExpressionRules = Object.freeze({
  precedence: Object.freeze([
    ['**'],
    ['*', '/', 'MOD'],
    ['+', '-'],
    ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE'],
    ['AND', 'OR', 'XOR'],
  ] as const),
  equalityTolerance: 1e-6,
  angleUnit: 'degrees',
  mod: 'positive',
  round: 'half-away',
  undefinedNamedParameter: 'error',
  // RS274NGC_MAX_PARAMETERS = 5602 is an array size (interp_parameter_def.hh:211), so 1-5601.
  maxParameter: 5601,
  maxDepth: 64,
});
