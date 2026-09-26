// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { foldService } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import { normaliseLabel, tokenizeLine, type OWordToken } from '@woodpatch/gcode-core';

/** Opener keyword → the keyword that closes it (same label). */
const CLOSER: Readonly<Record<string, string>> = {
  sub: 'endsub',
  if: 'endif',
  while: 'endwhile',
  do: 'while',
  repeat: 'endrepeat',
};
const CLOSERS = new Set(Object.values(CLOSER));

/** O-word lines are short; look for the O-word in at most this many characters. */
const SCAN_CHARS = 1000;
const MAYBE_OWORD = /(^|[^a-z])o\s*(\d|<)/i;

function owordOf(text: string): { label: string; keyword: string } | null {
  const head = text.slice(0, SCAN_CHARS);
  if (!MAYBE_OWORD.test(head)) return null;
  let t: OWordToken | undefined;
  try {
    t = tokenizeLine(head, 1).tokens.find((x): x is OWordToken => x.kind === 'oword');
  } catch {
    return null;
  }
  if (!t || !t.keyword) return null;
  // The core's own normalisation (o0100 = o100, <My Sub> = <mysub>), so they can't drift.
  return { label: normaliseLabel(head.slice(t.label.start, t.label.end)), keyword: t.keyword };
}

/**
 * Opener line → closer line, for the whole document, in ONE pass. It's built once per
 * document version (Text is immutable, so a WeakMap keyed on it is exact). The fold
 * gutter then answers every line from the map. Scanning ahead per line and per update
 * cost about 2.8 s with 150 unclosed openers on screen (reviewer, toolkit #21).
 *
 * Pairing uses a stack per label: an opener pushes; its closer pops the nearest open
 * block of the matching kind; a `while` closes an open `do` with its label, and
 * otherwise opens a while loop. Same-label blocks therefore nest.
 */
const indexes = new WeakMap<Text, ReadonlyMap<number, number>>();

function foldIndex(doc: Text): ReadonlyMap<number, number> {
  const cached = indexes.get(doc);
  if (cached) return cached;
  const pairs = new Map<number, number>();
  const open = new Map<string, { line: number; keyword: string }[]>();
  let n = 0;
  for (const text of doc.iterLines()) {
    n++;
    const o = owordOf(text);
    if (!o) continue;
    const stack = open.get(o.label) ?? [];
    open.set(o.label, stack);
    const top = stack[stack.length - 1];
    if (o.keyword === 'while' && top?.keyword === 'do') {
      stack.pop();
      pairs.set(top.line, n);
    } else if (CLOSER[o.keyword]) {
      stack.push({ line: n, keyword: o.keyword });
    } else if (CLOSERS.has(o.keyword)) {
      for (let k = stack.length - 1; k >= 0; k--) {
        const b = stack[k];
        if (b && CLOSER[b.keyword] === o.keyword) {
          stack.splice(k, 1);
          pairs.set(b.line, n);
          break;
        }
      }
    }
  }
  indexes.set(doc, pairs);
  return pairs;
}

/**
 * The fold range for an O-word block opening at document line `n`: from the end of
 * the opening line to the end of the line before its closer, so the closer stays
 * visible. Null for a line that opens nothing, has no closer, or has nothing to fold.
 */
export function oWordFoldRange(state: EditorState, n: number): { from: number; to: number } | null {
  const doc = state.doc;
  const closer = foldIndex(doc).get(n);
  if (closer === undefined || closer <= n + 1) return null;
  return { from: doc.line(n).to, to: doc.line(closer - 1).to };
}

export const gcodeFolding = foldService.of((state, lineStart) => {
  const n = state.doc.lineAt(lineStart).number;
  return oWordFoldRange(state, n);
});
