---
'@woodpatch/gcode-viewer': minor
---

New `GcodeView2D`: a top-down (XY) plan view on a Canvas 2D, with pan, zoom about the
pointer, fit, an adaptive labelled grid, and the same highlight and click-to-pick as the
3D view. Its maths is exported too (`fitTransform`, `zoomAt`, `panBy`, `gridSpacing`,
`nearestSegment`, …).
