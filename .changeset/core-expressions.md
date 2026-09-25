---
'@woodpatch/gcode-core': minor
---

Expression parser and evaluator (`parseExpression`, `evaluate`) under per-dialect `ExpressionRules`,
with `LINUXCNC_RULES` (verified against LinuxCNC's interpreter) as the default. Never throws;
nesting is bounded.
