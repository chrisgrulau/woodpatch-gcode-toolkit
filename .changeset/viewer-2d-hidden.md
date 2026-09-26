---
'@woodpatch/gcode-viewer': patch
---

`GcodeView2D`: a program set while the view is hidden is fitted when the view first
gets a size, and hiding and showing the view keeps the user's pan and zoom (it no longer
re-fits on every show).
