---
'@woodpatch/gcode-core': minor
---

Subprograms and program flow: LinuxCNC O-words (sub/call/return, if/elseif/else,
while, do/while, repeat, break/continue) and Masso-style M98/M99 subprogram files,
loaded through a caller-supplied `resolveProgram`. Steps and diagnostics from
another file carry `file`. There's a per-controller call-depth limit, plus resource
limits (`limits`) for untrusted input. A sign before a parameter, bracket or
function (`X-#1`) is now read as LinuxCNC does.

As corrected in review against LinuxCNC 2.9:

- unpassed call arguments are zeroed;
- `repeat` counts round half to even;
- `#<_value>` is set to 0 by a valueless return, and is read-only;
- an elseif is evaluated whenever it's reached;
- extra words on an O-word line, a failed call, and a definition reached again all
  stop the run.

New limits: `maxSteps`, `maxDiagnostics` and `maxPecks`. The latter fixes a G73/G83
peck loop that could fail to terminate.
