---
'@woodpatch/gcode-core': minor
---

Lossless G-code line model: `parse`, `write`, `editLine`, `replaceLine` and `tokenizeLine`.
`write(parse(x)) === x` for any input; every problem is a positioned diagnostic and
parsing never throws.
