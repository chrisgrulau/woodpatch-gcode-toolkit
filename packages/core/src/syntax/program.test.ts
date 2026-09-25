// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editLine, parse, replaceLine, write, type Program, type Token } from '../index.js';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
const corpus = ['synthetic', 'upstream'].flatMap((dir) =>
  readdirSync(join(FIXTURES, dir))
    .filter((f) => /\.(ngc|nc)$/.test(f))
    .map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(FIXTURES, dir, f), 'utf8') })),
);

/**
 * Structural invariants every parse must satisfy, whatever the input. Plain loops
 * with one assertion at the end: per-token expect() calls cost seconds on the
 * 224k-line sample.
 */
function assertWellFormed(program: Program): void {
  const problems: string[] = [];
  for (const line of program.lines) {
    let pos = 0;
    for (const t of line.tokens) {
      if (t.span.start < pos || t.span.end < t.span.start || t.span.end > line.text.length) {
        problems.push(`line ${line.lineNo}: bad or overlapping span ${JSON.stringify(t.span)}`);
      }
      pos = t.span.end;
    }
    for (const d of line.diagnostics) {
      if (d.line !== line.lineNo)
        problems.push(`line ${line.lineNo}: diagnostic says line ${d.line}`);
      if (d.span && d.span.end > line.text.length)
        problems.push(`line ${line.lineNo}: diagnostic span out of range`);
    }
  }
  expect(problems).toEqual([]);
}

const words = (tokens: readonly Token[]) =>
  tokens.flatMap((t) =>
    t.kind === 'word' ? [`${t.letter}${t.value?.kind === 'number' ? t.value.value : '…'}`] : [],
  );
const codes = (p: Program) => p.diagnostics.map((d) => d.code);

describe('round trip: write(parse(x)) === x', () => {
  it.each(corpus.map((c) => [c.name, c.text] as const))('%s', (_name, text) => {
    const program = parse(text);
    expect(write(program)).toBe(text);
    assertWellFormed(program);
  });

  it('holds for arbitrary text, and parsing never throws', () => {
    // Bias towards G-code-ish characters and every kind of line break, plus full unicode.
    const gcodeChar = fc.constantFrom(
      ...'GXYZIJKFRNMOTS0123456789.-+ \t()[];#<>=/*%eE\r\n'.split(''),
    );
    const text = fc.oneof(
      fc.string({ unit: gcodeChar, maxLength: 200 }),
      fc.string({ unit: 'binary', maxLength: 200 }),
    );
    fc.assert(
      fc.property(text, (s) => {
        const program = parse(s);
        expect(write(program)).toBe(s);
        assertWellFormed(program);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('lines and encodings', () => {
  it('treats LF, CRLF and bare CR as line breaks, remembering each (fixes N4)', () => {
    const p = parse('G21\rG1 X10\r\nG1 Y10\nM30');
    expect(p.lines.map((l) => [l.text, l.eol])).toEqual([
      ['G21', '\r'],
      ['G1 X10', '\r\n'],
      ['G1 Y10', '\n'],
      ['M30', ''],
    ]);
  });

  it('records and strips a leading BOM', () => {
    const p = parse('﻿G21\n');
    expect(p.bom).toBe(true);
    expect(p.lines[0]!.text).toBe('G21');
    expect(p.lines[0]!.tokens[0]!.span.start).toBe(0);
  });

  it('numbers lines from 1 and keeps a final empty line', () => {
    const p = parse('G0 X1\n');
    expect(p.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(p.lines[1]!.text).toBe('');
  });

  it('parses the empty string as one empty line', () => {
    expect(parse('').lines).toHaveLength(1);
  });
});

describe('words and numbers', () => {
  it('reads letters case-insensitively, and every number form', () => {
    const t = parse('g1 x1. Y.5 Z-2.25 F+300').lines[0]!.tokens;
    expect(words(t)).toEqual(['G1', 'X1', 'Y0.5', 'Z-2.25', 'F300']);
  });

  it('keeps each word of a no-space line', () => {
    expect(words(parse('G1X2Y3').lines[0]!.tokens)).toEqual(['G1', 'X2', 'Y3']);
  });

  it('keeps every repeated word; deciding which wins is semantics (N3)', () => {
    expect(words(parse('G1 X5 X10 F100 F600').lines[0]!.tokens)).toEqual([
      'G1',
      'X5',
      'X10',
      'F100',
      'F600',
    ]);
  });

  it('reads spaces inside a number as RS274 says, with an info diagnostic', () => {
    const p = parse('G1 X1 0');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X10']);
    expect(p.diagnostics[0]).toMatchObject({ severity: 'info', code: 'SYNTAX_SPACE_IN_NUMBER' });
  });

  it('notes a space between a sign and its digits', () => {
    const p = parse('G1 X+ 2');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X2']);
    expect(p.diagnostics[0]).toMatchObject({ code: 'SYNTAX_SPACE_IN_NUMBER' });
  });

  it('warns that X1e3 is X1 then E3, not an exponent (surfaces R6)', () => {
    const p = parse('G1 X1e3');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X1', 'E3']);
    expect(codes(p)).toContain('SYNTAX_POSSIBLE_EXPONENT');
  });

  it('reports a letter with no value, and keeps going', () => {
    const p = parse('G1 X Y2');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X…', 'Y2']);
    expect(codes(p)).toEqual(['SYNTAX_MISSING_VALUE']);
  });

  it('accepts rotary axes and D words as words (the dialect judges them; fixes R7)', () => {
    expect(words(parse('G1 A10 B5 C1 X5').lines[0]!.tokens)).toEqual([
      'G1',
      'A10',
      'B5',
      'C1',
      'X5',
    ]);
    expect(words(parse('G41 D1').lines[0]!.tokens)).toEqual(['G41', 'D1']);
  });
});

describe('expressions and parameters (syntax only; evaluation is 2b)', () => {
  const exprText = (src: string) => {
    const line = parse(src).lines[0]!;
    return line.tokens.flatMap((t) =>
      t.kind === 'word' && t.value?.kind === 'expression'
        ? [line.text.slice(t.value.span.start, t.value.span.end)]
        : [],
    );
  };

  it('captures bracketed expressions, parameters and functions as word values', () => {
    expect(exprText('G1 X[#1*2] Y#<depth> Z##2 F SIN[30] R ATAN[1]/[2]')).toEqual([
      '[#1*2]',
      '#<depth>',
      '##2',
      'SIN[30]',
      'ATAN[1]/[2]',
    ]);
  });

  it('nests brackets', () => {
    expect(exprText('G1 X[[1 LT 2]+[1 AND 1]]')).toEqual(['[[1 LT 2]+[1 AND 1]]']);
  });

  it('reads assignments', () => {
    const [a] = parse('#<depth>=[#1-2]').lines[0]!.tokens;
    expect(a).toMatchObject({ kind: 'assignment', target: { start: 0, end: 8 } });
  });

  it('reports an unbalanced bracket but keeps the words before it', () => {
    const p = parse('G1 Y2 X[1+2');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'Y2', 'X…']);
    expect(codes(p)).toContain('SYNTAX_UNBALANCED_BRACKET');
  });
});

describe('comments', () => {
  it('reads paren and semicolon comments with their text', () => {
    const t = parse('N10 G1 X1 (feed in) ; trailing').lines[0]!.tokens;
    expect(
      t.filter((x) => x.kind === 'comment').map((c) => c.kind === 'comment' && c.text),
    ).toEqual(['feed in', ' trailing']);
  });

  it('keeps the words before an unterminated comment (fixes R7)', () => {
    const p = parse('G1 X5 F100 (unterminated');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X5', 'F100']);
    expect(codes(p)).toEqual(['SYNTAX_UNTERMINATED_COMMENT']);
  });
});

describe('statements', () => {
  it('reads block delete, % lines and checksums', () => {
    expect(parse('/G1 X20').lines[0]!.tokens[0]!.kind).toBe('block-delete');
    expect(parse('%').lines[0]!.tokens[0]!.kind).toBe('percent');
    expect(parse('N1 G21 G90*23').lines[0]!.tokens.at(-1)).toMatchObject({
      kind: 'checksum',
      value: 23,
    });
  });

  it('reads LinuxCNC O-words with keywords and arguments', () => {
    const t = parse('o100 call [10] [2]').lines[0]!.tokens;
    expect(t.map((x) => x.kind)).toEqual(['oword', 'argument', 'argument']);
    expect(t[0]).toMatchObject({ keyword: 'call' });
    expect(parse('O<loop> while [#1 LT 3]').lines[0]!.tokens[0]).toMatchObject({
      keyword: 'while',
    });
  });

  it('reads a Fanuc program number, and Fanuc M98/M99 as ordinary words', () => {
    expect(parse('O1000').lines[0]!.tokens[0]).toMatchObject({ kind: 'oword', keyword: null });
    expect(words(parse('M98 P1000 L2').lines[0]!.tokens)).toEqual(['M98', 'P1000', 'L2']);
  });

  it('reports an astral character once, by code point', () => {
    // X has no value, the emoji is unexpected, and a stray "1" follows: 3 findings,
    // but exactly ONE covers the emoji, and it spans both UTF-16 units.
    const p = parse('G1 X\u{1F600}1');
    const atEmoji = p.diagnostics.filter((d) => d.span && d.span.start <= 4 && d.span.end > 4);
    expect(atEmoji).toHaveLength(1);
    expect(atEmoji[0]).toMatchObject({
      code: 'SYNTAX_UNEXPECTED_CHARACTER',
      span: { start: 4, end: 6 },
    });
    expect(atEmoji[0]!.message).toContain('\u{1F600}');
    expect(p.diagnostics.some((d) => d.span?.start === 5)).toBe(false); // no half-surrogate report
  });

  it('reports, and skips, a character that is not G-code', () => {
    const p = parse('G1 X1 é Y2');
    expect(words(p.lines[0]!.tokens)).toEqual(['G1', 'X1', 'Y2']);
    expect(codes(p)).toEqual(['SYNTAX_UNEXPECTED_CHARACTER']);
  });
});

describe('editing', () => {
  it('changes only the edited span; everything else is byte-identical', () => {
    const src = 'N10 G1  X1.50 (keep  this)   Y-2.\r\nG0 X0\n';
    const program = parse(src);
    const line = program.lines[0]!;
    const x = line.tokens.find((t) => t.kind === 'word' && t.letter === 'X');
    if (x?.kind !== 'word' || x.value?.kind !== 'number') throw new Error('no X');
    const edited = replaceLine(program, editLine(line, [{ span: x.value.span, text: '3.25' }]));
    expect(write(edited)).toBe('N10 G1  X3.25 (keep  this)   Y-2.\r\nG0 X0\n');
  });

  it('re-tokenizes an edited line, so parse(write(p)) equals p', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e4, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 5 }),
        (values) => {
          const src = 'G1 ' + values.map((_, i) => `${'XYZIJ'[i]}0`).join(' ') + ' (c)';
          const program = parse(src);
          const line = program.lines[0]!;
          const edits = line.tokens.flatMap((t, i) =>
            t.kind === 'word' && t.letter !== 'G' && t.value?.kind === 'number'
              ? [{ span: t.value.span, text: values[i - 1]!.toFixed(3) }]
              : [],
          );
          const edited = replaceLine(program, editLine(line, edits));
          const reparsed = parse(write(edited));
          expect(reparsed.lines[0]!.tokens).toEqual(edited.lines[0]!.tokens);
          expect(reparsed.lines[0]!.text.endsWith(' (c)')).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects overlapping edits and line breaks as programming errors', () => {
    const line = parse('G1 X1 Y2').lines[0]!;
    expect(() =>
      editLine(line, [
        { span: { start: 3, end: 5 }, text: 'a' },
        { span: { start: 4, end: 6 }, text: 'b' },
      ]),
    ).toThrow(RangeError);
    expect(() => editLine(line, [{ span: { start: 0, end: 1 }, text: '\n' }])).toThrow(RangeError);
  });
});
