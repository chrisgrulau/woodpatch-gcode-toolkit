// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * @woodpatch/gcode-editor: CodeMirror 6 support for G-code (parcel 3b, ADR-0027).
 * CodeMirror is a peer dependency: the host provides it (and its own basic setup).
 */
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@woodpatch/gcode-core';
import { toLintDiagnostics } from './diagnostics.js';
import { gcodeFolding } from './fold.js';
import { gcodeHighlighter, gcodeTheme } from './highlight.js';
import { onCursorLine, pathLineField } from './sync.js';

export interface GcodeEditorOptions {
  /** Called with the 1-based line when the cursor moves to another line. */
  readonly onCursorLine?: (line: number) => void;
  /** Show the diagnostics gutter. Default true. */
  readonly gutter?: boolean;
}

/** The G-code extensions: highlighting, theme, O-word folding, path-line marking. */
export function gcode(options: GcodeEditorOptions = {}): Extension[] {
  return [
    gcodeHighlighter,
    gcodeTheme,
    gcodeFolding,
    pathLineField,
    ...(options.gutter === false ? [] : [lintGutter()]),
    ...(options.onCursorLine ? [onCursorLine(options.onCursorLine)] : []),
  ];
}

/**
 * Shows the core's diagnostics in the editor (replacing the previous set). Returns
 * how many were left out because they belong to a subprogram file.
 */
export function showDiagnostics(view: EditorView, diagnostics: readonly Diagnostic[]): number {
  const { diagnostics: mapped, skipped } = toLintDiagnostics(view.state.doc, diagnostics);
  view.dispatch(setDiagnostics(view.state, mapped));
  return skipped;
}

export { lineSpans, type StyleSpan } from './tokens.js';
export { toLintDiagnostics } from './diagnostics.js';
export { oWordFoldRange, gcodeFolding } from './fold.js';
export {
  buildHighlights,
  gcodeHighlighter,
  gcodeTheme,
  MAX_STYLED_CHARS,
  styledSpans,
  type VisibleView,
} from './highlight.js';
export { cursorLine, onCursorLine, pathLineField, setPathLine, showPathLine } from './sync.js';
