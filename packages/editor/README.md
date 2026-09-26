<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# @woodpatch/gcode-editor

CodeMirror 6 support for G-code (ADR-0027).

```ts
import { EditorView, basicSetup } from 'codemirror';
import { gcode, showDiagnostics, showPathLine } from '@woodpatch/gcode-editor';

const view = new EditorView({
  parent: document.getElementById('editor')!,
  doc: text,
  extensions: [basicSetup, gcode({ onCursorLine: (n) => viewer.highlightLine(n) })],
});
showDiagnostics(view, program.diagnostics); // from @woodpatch/gcode-viewer's loadProgram
viewer.onPick(({ line }) => showPathLine(view, line));
```

- **Highlighting comes from the core's own tokenizer,** so the editor colours exactly
  what the interpreter reads. Only visible lines are styled.
- **Diagnostics** go in the lint gutter, with hover messages. Those from subprogram files
  are counted but not shown, since they belong to other files.
- **O-word blocks fold** (`sub`, `if`, `while`, `do`, `repeat`).
- **Line ↔ path:** the cursor's line goes out through `onCursorLine`. `showPathLine`
  marks a line picked in the viewer without moving the cursor, so the two can't loop.
- CodeMirror is a peer dependency: your app provides it.
