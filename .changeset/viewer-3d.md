---
'@woodpatch/gcode-viewer': minor
---

The first release of the 3D viewer. `GcodeViewer` draws the path with three.js (a peer
dependency), with real line widths, orbit controls, fit and standard views, a grid,
line highlight and click-to-pick. `loadProgram` and the `/worker` entry run the core
off the main thread, and `ProgramLoader` cancels a superseded load by terminating its
worker.
