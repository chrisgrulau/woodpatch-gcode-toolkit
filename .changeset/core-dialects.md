---
'@woodpatch/gcode-core': minor
---

Dialect profiles: `MASSO_G3` (v5.13), `LINUXCNC` (2.9) and `GENERIC`, chosen with
`interpret(program, { dialect })`. They cover code lists, expressions, block delete,
MSG lines and `(MSG, …)` comments (new `message` step), feed moves with no F (new
feed mode `unspecified`), G80 behaviour and canned-cycle switching. The Masso
profile reproduces the recorded results of a test run on the real machine. The
tokenizer reads Masso `MSG` lines as a `message` token.
