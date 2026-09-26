---
'@woodpatch/gcode-editor': minor
---

The first release of the editor extensions for CodeMirror 6. `gcode()` adds:

- highlighting from the core's tokenizer (visible lines only);
- a theme;
- O-word folding;
- line ↔ path sync (`onCursorLine`, `showPathLine`).

`showDiagnostics()` puts the core's diagnostics in the lint gutter. CodeMirror is a
peer dependency.
