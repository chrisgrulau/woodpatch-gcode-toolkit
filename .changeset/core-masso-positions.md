---
'@woodpatch/gcode-core': minor
---

Completes the Masso G3 profile:

- G10 L2.1/L20/L20.1 and the G54.1 P1–P100 extended offsets.
- G28 to machine home and G30 to the parking position, Z first, using the new
  `machine.home` / `machine.park` options.
- M66 as a new `wait` step.
- M6.1 tool unload.
- Tool-change ordering warnings.
- Advice to dwell after a spindle-speed change.
- A warning band for arc mismatches beyond the tested limit
  (`arcTolerance.beyond`).
