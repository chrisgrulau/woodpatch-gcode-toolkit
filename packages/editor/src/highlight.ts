// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { lineSpans } from './tokens.js';

const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

/**
 * Style at most this many characters of a line. G-code lines are short; a pathological
 * one (a 5 MB single line) would otherwise be tokenized in full on every keystroke,
 * though only part of it is ever on screen (reviewer, toolkit #21).
 */
export const MAX_STYLED_CHARS = 2000;

/**
 * The spans to style on document line `n`: the core's tokens, for at most the first
 * MAX_STYLED_CHARS characters. It never throws; a tokenizer failure styles nothing.
 * Line 1's byte-order mark is skipped, as the core skips it.
 */
export function styledSpans(text: string, n: number) {
  const bom = n === 1 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const body = text.slice(bom, bom + MAX_STYLED_CHARS);
  let spans;
  try {
    spans = lineSpans(body);
  } catch {
    return [];
  }
  return spans
    .map((s) => ({ from: s.from + bom, to: s.to + bom, cls: s.cls }))
    .sort((a, b) => a.from - b.from || b.to - a.to);
}

/** What `build` needs from a view: its state and visible ranges (a fake in tests). */
export interface VisibleView {
  readonly state: EditorView['state'];
  readonly visibleRanges: readonly { readonly from: number; readonly to: number }[];
}

/**
 * Decorations for the visible lines only: a 224k-line file costs what the screen shows.
 * CodeMirror can split ONE long line into several visible ranges (its long-line gaps,
 * and the window kept around the cursor), so a line is styled once, the first time
 * it's reached; styling it again would add ranges out of order, and RangeSetBuilder
 * throws, which disables the plugin (reviewer, toolkit #21).
 */
export function buildHighlights(view: VisibleView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      for (const s of styledSpans(line.text, line.number)) {
        if (s.to > s.from) builder.add(line.from + s.from, line.from + s.to, mark(s.cls));
      }
    }
  }
  return builder.finish();
}

export const gcodeHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHighlights(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildHighlights(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Colours, light and dark. Roles, not rainbows: motion codes, positions, centres and
 * feeds are distinct; comments recede; expressions are underlined as "computed".
 */
export const gcodeTheme = EditorView.baseTheme({
  '&light .gc-g': { color: '#1f5fbf', fontWeight: '600' },
  '&dark .gc-g': { color: '#7cb2ff', fontWeight: '600' },
  '&light .gc-m': { color: '#8a2be2', fontWeight: '600' },
  '&dark .gc-m': { color: '#c79bff', fontWeight: '600' },
  '&light .gc-axis': { color: '#1a1a1a' },
  '&dark .gc-axis': { color: '#e8e8e8' },
  '&light .gc-centre': { color: '#0b7a75' },
  '&dark .gc-centre': { color: '#5fd4cc' },
  '&light .gc-feed, &light .gc-speed': { color: '#b35900' },
  '&dark .gc-feed, &dark .gc-speed': { color: '#ffb366' },
  '&light .gc-tool': { color: '#a0006e' },
  '&dark .gc-tool': { color: '#ff79c6' },
  '.gc-lineno': { opacity: '0.55' },
  '&light .gc-param': { color: '#5a5a5a' },
  '&dark .gc-param': { color: '#b8b8b8' },
  '&light .gc-comment': { color: '#6a737d', fontStyle: 'italic' },
  '&dark .gc-comment': { color: '#8b949e', fontStyle: 'italic' },
  '.gc-expr': { textDecoration: 'underline dotted' },
  '&light .gc-oword, &light .gc-assign': { color: '#005cc5', fontWeight: '600' },
  '&dark .gc-oword, &dark .gc-assign': { color: '#79c0ff', fontWeight: '600' },
  '&light .gc-message': { color: '#22863a' },
  '&dark .gc-message': { color: '#7ee787' },
  '.gc-blockdelete, .gc-percent, .gc-checksum': { opacity: '0.6' },
  '&light .gc-path-line': { backgroundColor: '#fff3b0' },
  '&dark .gc-path-line': { backgroundColor: '#4a4200' },
});
