// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { foldService } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { tokenizeLine, type OWordToken } from '@woodpatch/gcode-core';

/** Opener keyword → the keyword that closes it (same label). */
const CLOSER: Readonly<Record<string, string>> = {
  sub: 'endsub',
  if: 'endif',
  while: 'endwhile',
  do: 'while',
  repeat: 'endrepeat',
};

/** How far to look for a closer: a fold never costs a scan of a huge file. */
const MAX_SCAN = 20_000;
const MAYBE_OWORD = /(^|[^a-z])o\s*(\d|<)/i;

function owordOf(text: string): { label: string; keyword: string } | null {
  if (!MAYBE_OWORD.test(text)) return null;
  const t = tokenizeLine(text, 1).tokens.find((x): x is OWordToken => x.kind === 'oword');
  if (!t || !t.keyword) return null;
  const raw = text.slice(t.label.start, t.label.end);
  const label = raw.startsWith('<')
    ? raw.slice(1, -1).replace(/[ \t]/g, '').toLowerCase()
    : String(Number(raw));
  return { label, keyword: t.keyword };
}

/**
 * The fold range for an O-word block opening at document line `n`: from the end of
 * the opening line to the end of the line before its closer, so the closer stays
 * visible. Same-label blocks nest (a sub calling itself recursively has one body).
 */
export function oWordFoldRange(state: EditorState, n: number): { from: number; to: number } | null {
  const doc = state.doc;
  const open = owordOf(doc.line(n).text);
  if (!open) return null;
  const closer = CLOSER[open.keyword];
  if (!closer) return null;
  let depth = 0;
  const last = Math.min(doc.lines, n + MAX_SCAN);
  for (let i = n + 1; i <= last; i++) {
    const o = owordOf(doc.line(i).text);
    if (!o || o.label !== open.label) continue;
    if (o.keyword === open.keyword && open.keyword !== 'do') depth++;
    else if (o.keyword === closer) {
      if (depth === 0) {
        if (i === n + 1) return null; // nothing between to fold
        return { from: doc.line(n).to, to: doc.line(i - 1).to };
      }
      depth--;
    }
  }
  return null;
}

export const gcodeFolding = foldService.of((state, lineStart) => {
  const n = state.doc.lineAt(lineStart).number;
  return oWordFoldRange(state, n);
});
