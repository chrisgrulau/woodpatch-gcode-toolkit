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

/** Decorations for the visible lines only: a 224k-line file costs what the screen shows. */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      // Spans come sorted and may nest (an expression inside its word): the builder
      // needs them sorted by start, then by end descending, which is the order here.
      const spans = lineSpans(line.text).sort((a, b) => a.from - b.from || b.to - a.to);
      for (const s of spans) {
        if (s.to > s.from) builder.add(line.from + s.from, line.from + s.to, mark(s.cls));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const gcodeHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
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
