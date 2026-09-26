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

As corrected in review against LinuxCNC 2.9:

- the sweep follows the motion planner (`motionSweep`: a near-closed arc is a full
  circle);
- arc checks are fail-closed, with non-finite and R0 refused;
- 2.9's arc word checks apply;
- `tessellate()` budgets vertices before allocating (`maxChordsPerArc`, a
  2,000,000 default for `maxVertices`, and `coarsened`), and uses a chord formula
  that stays accurate at huge radii.
