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

As corrected in review:

- each line is styled once, even when split into several visible ranges;
- styling is capped at 2,000 characters per line, and never throws;
- folds come from a one-pass index cached per document version;
- line 1's byte-order mark is skipped.

The core now exports `normaliseLabel`.
