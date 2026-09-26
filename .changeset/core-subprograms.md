---
'@woodpatch/gcode-core': minor
---

Subprograms and program flow: LinuxCNC O-words (sub/call/return, if/elseif/else,
while, do/while, repeat, break/continue) and Masso-style M98/M99 subprogram files,
loaded through a caller-supplied `resolveProgram`. Steps and diagnostics from
another file carry `file`. There's a per-controller call-depth limit, plus resource
limits (`limits`) for untrusted input. A sign before a parameter, bracket or
function (`X-#1`) is now read as LinuxCNC does.
