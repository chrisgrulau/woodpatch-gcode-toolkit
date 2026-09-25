// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * The lossless line model (plan §4.2 item 1, ADR-0017).
 *
 * Every source line keeps its exact text. Tokens never own text; they point into
 * the line by {@link Span}. That gives two guarantees the rest of the toolkit
 * builds on:
 *
 * - `write(parse(text)) === text` for ANY input, byte for byte, including
 *   malformed G-code, mixed line endings and a byte-order mark.
 * - An edit (a transform in Phase 4) splices new text into a token's span and
 *   leaves every other character of the file untouched: comments, number
 *   formatting, spacing and line endings.
 *
 * Nothing here interprets G-code: which letters are axes, what G1 means, or
 * whether a word is supported are questions for the interpreter and the dialect
 * profile. The syntax layer only answers "what is written, and where".
 */

/** Half-open range `[start, end)` of UTF-16 code-unit offsets within a line's `text`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export type Severity = 'error' | 'warning' | 'info';

/**
 * A finding about the program. Never thrown: every problem becomes one of these,
 * with a location, so nothing fails silently (plan §4.2 item 4).
 */
export interface Diagnostic {
  readonly severity: Severity;
  /** Stable machine-readable code, e.g. `SYNTAX_UNTERMINATED_COMMENT`. */
  readonly code: string;
  readonly message: string;
  /** 1-based line number. */
  readonly line: number;
  readonly span?: Span;
}

/** A plain decimal number, e.g. `-1.5`, `2.`, `.25`. */
export interface NumberValue {
  readonly kind: 'number';
  readonly span: Span;
  readonly value: number;
}

/**
 * A value that needs evaluating: a bracketed expression `[…]`, a parameter
 * reference `#1`, `#<name>` or `##2`, or a unary function such as `SIN[30]`.
 * Its source is `text.slice(span.start, span.end)`; the expression layer parses it.
 */
export interface ExpressionValue {
  readonly kind: 'expression';
  readonly span: Span;
}

export type Value = NumberValue | ExpressionValue;

/** A letter and its value, e.g. `G1`, `X-2.5`, `F[#1*2]`. `letter` is upper-cased. */
export interface WordToken {
  readonly kind: 'word';
  readonly span: Span;
  readonly letter: string;
  /** `null` when the letter has no value; that also produces a diagnostic. */
  readonly value: Value | null;
}

/** A parameter assignment, e.g. `#1=10` or `#<depth>=[#1*2]`. */
export interface AssignmentToken {
  readonly kind: 'assignment';
  readonly span: Span;
  /** The parameter reference being assigned: `#1`, `#<depth>`, `#[#2]`. */
  readonly target: Span;
  readonly value: Value | null;
}

/** `( … )` or `; …`. `text` is the content, without the delimiters. */
export interface CommentToken {
  readonly kind: 'comment';
  readonly span: Span;
  readonly style: 'paren' | 'semicolon';
  readonly text: string;
  /** False for a `(` that never closes; the comment then runs to the end of the line. */
  readonly terminated: boolean;
}

/**
 * An O-word: a LinuxCNC-style control statement (`o100 sub`, `o<loop> while [#1 LT 3]`)
 * or a Fanuc-style program number (`O1000`). The label is a number or `<name>`.
 * The keyword is lower-cased, or absent for a bare program number. Arguments and
 * conditions follow as `argument` tokens.
 */
export interface OWordToken {
  readonly kind: 'oword';
  readonly span: Span;
  readonly label: Span;
  readonly keyword: string | null;
}

/** A bracketed argument or condition after an O-word, e.g. the `[10]` in `o100 call [10]`. */
export interface ArgumentToken {
  readonly kind: 'argument';
  readonly span: Span;
  readonly value: ExpressionValue;
}

/** `/` at the start of a line: block delete (optional skip). */
export interface BlockDeleteToken {
  readonly kind: 'block-delete';
  readonly span: Span;
}

/** A `%` tape/program delimiter line. Anything after the `%` is kept in the span. */
export interface PercentToken {
  readonly kind: 'percent';
  readonly span: Span;
}

/** A trailing `*nn` line checksum (grbl/RepRap style). */
export interface ChecksumToken {
  readonly kind: 'checksum';
  readonly span: Span;
  readonly value: number;
}

export type Token =
  | WordToken
  | AssignmentToken
  | CommentToken
  | OWordToken
  | ArgumentToken
  | BlockDeleteToken
  | PercentToken
  | ChecksumToken;

export type LineEnding = '\r\n' | '\n' | '\r' | '';

export interface Line {
  /** 1-based line number, as an editor shows it. */
  readonly lineNo: number;
  /** The line's exact source text, without its line ending (and without a leading BOM). */
  readonly text: string;
  /** The exact line ending that followed the line: `''` for a final line with none. */
  readonly eol: LineEnding;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface Program {
  /** True when the source began with a UTF-8 byte-order mark (U+FEFF). */
  readonly bom: boolean;
  readonly lines: readonly Line[];
  /** Every line's diagnostics, in line order. */
  readonly diagnostics: readonly Diagnostic[];
}
