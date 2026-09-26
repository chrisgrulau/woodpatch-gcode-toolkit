---
'@woodpatch/gcode-editor': patch
---

`lineSpans` (public) is bounded and guarded itself. It tokenizes at most `maxChars`
characters (default 2,000) and returns no spans instead of throwing on a pathological
line.
