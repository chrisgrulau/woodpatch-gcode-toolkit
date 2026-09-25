// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { tokenizeLine } from './tokenize.js';
import type { Line, LineEnding, Program, Span } from './types.js';

const BOM = '﻿';

/**
 * Parses G-code text into the lossless line model.
 *
 * Never throws. LF, CRLF and bare CR line endings are all line breaks, and each
 * line remembers its own. Upstream treated a bare-CR file as one line (N4). A
 * leading byte-order mark is recorded and removed from the first line's text.
 *
 * The last line is always present, even when empty: `"G0\n"` has two lines, the
 * second empty, exactly as an editor shows it.
 */
export function parse(source: string): Program {
  const bom = source.startsWith(BOM);
  const body = bom ? source.slice(1) : source;
  const lines: Line[] = [];

  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c !== 0x0a && c !== 0x0d) continue;
    const eol: LineEnding =
      c === 0x0d && body.charCodeAt(i + 1) === 0x0a ? '\r\n' : c === 0x0d ? '\r' : '\n';
    lines.push(makeLine(body.slice(start, i), eol, lines.length + 1));
    i += eol.length - 1;
    start = i + 1;
  }
  lines.push(makeLine(body.slice(start), '', lines.length + 1));

  return makeProgram(bom, lines);
}

/**
 * Writes the program back to text. For a program straight from {@link parse},
 * the result is byte-identical to the source; for an edited one, only the
 * edited spans differ.
 */
export function write(program: Program): string {
  let out = program.bom ? BOM : '';
  for (const line of program.lines) out += line.text + line.eol;
  return out;
}

/** A replacement of the text in `span` (offsets within the line's text). */
export interface LineEdit {
  readonly span: Span;
  readonly text: string;
}

/**
 * Returns a new line with `edits` applied and re-tokenized, keeping its number and
 * line ending. Text outside the edited spans is untouched, byte for byte. This is
 * the primitive every transform (Phase 4) is built on.
 *
 * Edits must lie within the line and must not overlap; violating that is a
 * programming error and throws a RangeError. G-code input never throws.
 */
export function editLine(line: Line, edits: readonly LineEdit[]): Line {
  const sorted = [...edits].sort((a, b) => a.span.start - b.span.start);
  let text = '';
  let pos = 0;
  for (const e of sorted) {
    if (e.span.start < pos || e.span.end < e.span.start || e.span.end > line.text.length) {
      throw new RangeError(
        `Invalid or overlapping edit [${e.span.start}, ${e.span.end}) on line ${line.lineNo}`,
      );
    }
    if (/[\r\n]/.test(e.text)) {
      throw new RangeError(`An edit may not insert a line break (line ${line.lineNo})`);
    }
    text += line.text.slice(pos, e.span.start) + e.text;
    pos = e.span.end;
  }
  text += line.text.slice(pos);
  return makeLine(text, line.eol, line.lineNo);
}

/** Returns a new program with `line` in place of the line with the same number. */
export function replaceLine(program: Program, line: Line): Program {
  const index = line.lineNo - 1;
  if (index < 0 || index >= program.lines.length) {
    throw new RangeError(`No line ${line.lineNo} in a program of ${program.lines.length} lines`);
  }
  const lines = program.lines.slice();
  lines[index] = line;
  return makeProgram(program.bom, lines);
}

function makeLine(text: string, eol: LineEnding, lineNo: number): Line {
  const { tokens, diagnostics } = tokenizeLine(text, lineNo);
  return { lineNo, text, eol, tokens, diagnostics };
}

function makeProgram(bom: boolean, lines: Line[]): Program {
  return { bom, lines, diagnostics: lines.flatMap((l) => l.diagnostics) };
}
