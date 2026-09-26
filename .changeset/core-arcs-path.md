---
'@woodpatch/gcode-core': minor
---

Arcs are resolved and validated as LinuxCNC does, with a per-dialect tolerance
(`InterpreterRules.arcTolerance`). An impossible R arc, a zero-radius arc or an
excessive radius mismatch is refused with a diagnostic. **Breaking:** arc steps
now always carry a resolved `centre`, plus `radius`, `endRadius` and signed
`sweep`; the signed R radius and `centre: null` are gone. New path model:
`tessellate()` returns the toolpath as one polyline in typed arrays, within a
chord tolerance, and `pathBounds()` returns exact bounding boxes (all, feed,
rapid).
