// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Line ↔ path sync (ADR-0027), upstream's `lineSegmentMap` UX kept (plan §2.3).
 * Editor → viewer: `onCursorLine` fires when the cursor moves to another line.
 * Viewer → editor: `showPathLine(view, n)` marks line n and scrolls it into view,
 * WITHOUT moving the cursor, so a click in the viewer can't loop back into it.
 */
export const setPathLine = StateEffect.define<number | null>();

const pathLineMark = Decoration.line({ class: 'gc-path-line' });

export const pathLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setPathLine)) continue;
      const n = e.value;
      next =
        n && n >= 1 && n <= tr.state.doc.lines
          ? Decoration.set([pathLineMark.range(tr.state.doc.line(n).from)])
          : Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The 1-based line of the main selection's head. */
export function cursorLine(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number;
}

/** Calls `listener` with the cursor's line whenever it moves to a different line. */
export function onCursorLine(listener: (line: number) => void) {
  return EditorView.updateListener.of((u) => {
    if (!u.selectionSet && !u.docChanged) return;
    const before = cursorLine(u.startState);
    const now = cursorLine(u.state);
    if (now !== before) listener(now);
  });
}

/** Marks line `n` as the one the viewer picked (null clears it) and scrolls to it. */
export function showPathLine(view: EditorView, n: number | null): void {
  const valid = n !== null && n >= 1 && n <= view.state.doc.lines;
  view.dispatch({
    effects: [
      setPathLine.of(valid ? n : null),
      ...(valid ? [EditorView.scrollIntoView(view.state.doc.line(n).from, { y: 'center' })] : []),
    ],
  });
}
