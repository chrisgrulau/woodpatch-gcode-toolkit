<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# Analysis of upstream webgcode's G-code core

Phase 1 deliverable. This describes what upstream's previewer core **actually does**, with
`file:line` references into `legacy/webapp/`, so the Phase 2 rewrite changes behaviour
deliberately and never by accident.

References to "the plan" (for example "plan §2.4") point to the programme's internal
planning document, which is deliberately not published (ADR-0011). Everything needed to
follow this analysis is in this repository.

**How the claims are backed.** The behavioural claims in §2–§7 and §10 are not from reading alone. §8 (display) and §13 (CAM salvage) are from reading the code.

| Evidence                                                                  | Where                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Characterisation goldens: upstream's output on 43 fixtures, bugs included | `fixtures/golden/legacy/` (ADR-0012), regenerated and diffed in CI |
| Independently published reference measurements for the 4 upstream samples | `tools/legacy-reference.test.cjs` (CI)                             |
| Defects R1 and R2                                                         | `tools/legacy-harness.test.cjs` (CI)                               |
| **New findings N1–N15** (§10)                                             | `tools/legacy-findings.test.cjs` (CI)                              |
| Benchmarks                                                                | `tools/bench-legacy.cjs`                                           |

The defect IDs **R1–R14** are the upstream defects verified before this project
started. **N1–N15** are new in this analysis (N13–N15 were found while building the Phase 2
expression evaluator).

---

## 1. Pipeline

```
text
 └─ split on /\r?\n/                                   parser.js:540      (N4: bare CR is not a line break)
     └─ per line: skip "%" lines                       parser.js:543
         └─ cleanLineUp: drop spaces/tabs, (…) comments, ;… comments          parser.js:477
             └─ parseLine: regex fast path, else jsparse grammar on UPPERCASED text  parser.js:467
                 └─ handleLineAst: F, then each G word in line order, then motion   parser.js:486
                     └─ path fragments {type: line|arc, from, to, feedRate, lineNo, speedTag}
                          ├─ display: arcs tessellated at 1 µm chord → Float32 chunks → three.js / SVG
                          │                                            gcodeSimulation.js:9, util.js
                          └─ analysis: simulator → total time + bounding box   simulation.js:236, :293
```

`simulateGCode()` (`gcodeSimulation.js:4`) runs the **parser a second time** with the
display listener attached, then the simulator. The live page ran this in a Web Worker
(`worker.js`). Errors are collected, never thrown, except where §3 says otherwise.

## 2. Reading a line

- **Line splitting** is `text.split(/\r?\n/)` (`parser.js:540`). LF and CRLF work. A file
  with **bare CR** endings becomes **one line**, so all its words merge (N4).
- **`%` lines** (tape markers) are skipped (`:543`).
- **Comments.** `(…)` is removed by `/[(][^)]*[)]/g` (non-nesting) and `;…` to the end of
  the line (`:481-482`). An unbalanced `(` survives, and the line fails to parse (R7).
- **Whitespace** is removed entirely _before_ parsing (`:479`), so `G 1 X 1 0` reads
  as `G1X10`. Tabs are included.
- **Fast path** (`:9-28`): if the whole cleaned line matches
  `^([FGHIJKLMNPRSTXYZ][-+]?[0-9]*\.?[0-9]+)+$` (case-insensitive), words are read by
  regex. **`E` is not in the fast-path set, but it is in the grammar's word set** (`:435`).
  So any `E` pushes the line onto the slow path, where `X1e3` becomes `X1 E3` (R6).
- **Slow path**: the jsparse grammar (`:307-475`) on the upper-cased line.
- **Word set**: `EFGIJKLMNPRSTXYZ` (`:435`). Missing: `A B C` (rotary axes), `D`
  (cutter-comp register), `O` (O-words), `/` (block delete) and `*` (checksums). Any of
  these makes the **whole line** fail with "did not understand line", losing its X/Y/Z
  (R7, R8).
- **Numbers**: `1`, `1.`, `.5`, `-1.5` and `+2` are accepted. Exponents are not (R6).
- **Repeated words** are collected into arrays. **F uses the first value** (`:489`, `fCode[0]`)
  but **axes, I/J/K and R use the last** (`:158`, `:190`, `:213-214`) (N3).
- **Line numbers are 0-based** in every fragment and error (`lineNo` = array index).

## 3. Expressions and parameters (slow path only)

Grammar at `parser.js:307-475`.

- **Parameters**: `#123` and `#<name>` (names lower-cased, `:320`). An unset parameter
  reads as 0 (`:325`), **including a named parameter that was never set**, silently.
  LinuxCNC reports that as an error (`interp_namedparams.cc:192`) (N15).
- **Assignment** `#1=…` is applied **after** the whole line is parsed (`:453-455`).
  RS274 specifies the same (the new value is visible from the next line), so this is
  correct. The right-hand side may be a bracketed expression, a number or a parameter
  (`:431`).
- **Where expressions may appear**: a word's value is only
  `[bracketed] | number | #param` (`:431`, `:435`). Unbracketed arithmetic after a word is
  not allowed, as in RS274.
- **Binary operators** by precedence (`:412-418`): `**` > `* / MOD` > `+ -` >
  `EQ NE GT GE LT LE` > `AND OR XOR`. All are left-associative via `chainl`, including
  `**`. These five levels **match LinuxCNC's documented table exactly** (LinuxCNC
  G-code overview, "Operators Precedence"). NIST RS274/NGC v3 is reported to use fewer
  groups, with `AND OR XOR` sharing a level with `+ −` and no relational operators; that
  source could not be retrieved to verify. Precedence is therefore a **per-dialect**
  property for Phase 2's dialect profiles, not a single "RS274" rule. `MOD` is
  JavaScript `%`, so its sign follows the dividend: `-7 MOD 3` is −1 upstream, and 2 in
  LinuxCNC, whose MOD "always calculates a positive answer" (N14).
- **`EQ` / `NE` are exact float equality** (`:377-382`). LinuxCNC instead treats values
  within 1e-6 as equal (`TOLERANCE_EQUAL`), so `[0.1+0.2] EQ 0.3` is 0 upstream and 1 in
  LinuxCNC. Another per-dialect difference for Phase 2.
- **Functions**: `ATAN[a]/[b]` (`:349`) plus `ABS ACOS ASIN COS EXP FIX FUP ROUND LN SIN
SQRT TAN EXISTS` (`:330-347`). `EXISTS` always returns 1 and logs `EXISTS TBD`.
- **Trig works in RADIANS** (`Math.sin` etc., `:330-347`). RS274/NGC and LinuxCNC take and
  return **degrees** (`interp_execute.cc`: `sin(x·π/180)`, `asin(x)·180/π`). So `SIN[30]`
  is −0.988 upstream instead of 0.5, and `ATAN[1]/[1]` is 0.785 instead of 45 (N13). Any
  program that computes positions with trig draws the wrong geometry, with no error.
  `ROUND` is `Math.round`, so `ROUND[-2.5]` is −2; LinuxCNC rounds half away from zero,
  giving −3 (N14).
- **R1, root cause, confirmed.** The function table is registered with `$.each` over an
  **object** (`:354`). The worker's own `$` (`worker.js:2-24`) iterates `array.length`, so
  on the live page **only `ATAN` is registered**. Any other function then falls through
  to `expression`'s own left-recursive fallback (`:422`, `choice(…, expression)`), which
  recurses until the stack overflows (`RangeError`). With a jQuery-faithful `$`, `SIN[0]`
  works, but a genuinely malformed expression (`[FOO]`, `[1+]`) still overflows. The
  goldens record both flavours (`r1-bracket-function.json`, `jqueryFlavour`). On the live
  page, the worker caught the error, logged it and called `self.close()` without
  replying (`gcodeSimulation.js:47-50`), so the UI waited forever.

## 4. Code coverage

`GROUPS_TRANSITIONS` (`parser.js:58-89`) and `NON_MODAL` (`:54-56`) are the entire
vocabulary.

| Code                                          | Upstream behaviour                                                                                                                                                      | RS274 / reality     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| G0                                            | Rapid at `travelFeedRate`: default **3000 mm/min** (N9)                                                                                                                 | machine rapid rate  |
| G1                                            | Linear at the modal feed, **capped at 3000 mm/min** by default (R10); **200 mm/min** if no F was ever given, silently (N10)                                             |                     |
| G2 / G3                                       | Arcs, I/J/K or R format, grbl maths (§5)                                                                                                                                |                     |
| G4                                            | Accepted and **ignored**: no dwell, and no time added (N8)                                                                                                              | dwell P seconds     |
| G10                                           | **L2 only** (work offsets P1–P9). Anything else throws, and the line is reported. Prints the line to the console (`:113`)                                               | L1, L20 and others  |
| G17 / G18 / G19                               | Plane select. G18 uses ZX order (first = Z, second = X; `:46-52`), which is correct                                                                                     |                     |
| G20 / G21                                     | Unit converter for subsequent words (`:104-110`)                                                                                                                        |                     |
| G40 / G41 / G42                               | Error "not supported", **then the line's motion still runs uncompensated**                                                                                              | cutter compensation |
| G49                                           | Accepted, no effect                                                                                                                                                     |                     |
| G54 – G59.3                                   | Select work offset 1–9                                                                                                                                                  |                     |
| G61 / G61.1 / G64                             | Stored in `pathControl`, **never used** by the planner                                                                                                                  |                     |
| G80                                           | Motion mode "none"                                                                                                                                                      |                     |
| G81 – G89                                     | **Not in the table.** Error "Did not understand", **then the axis words run under the current motion mode**: a rapid plunge to depth, then a rapid across at depth (R4) | canned cycles       |
| G90 / G91                                     | Absolute / incremental                                                                                                                                                  |                     |
| G94                                           | Accepted, no effect                                                                                                                                                     |                     |
| G28, G30, G43, G53, G92, G93, G90.1, G91.1, … | Error "Did not understand Gn", **then the line's motion runs as an ordinary move** in the current mode and work coordinates (N5, N6)                                    |                     |
| **All M codes**                               | Parsed and **silently ignored**. **M2/M30 do not end the program**: later moves are drawn (R8, N12)                                                                     |                     |
| S, T, H, L, P, Q                              | Parsed. Only G10 uses L and P, and only G4 would use P. S and T are ignored                                                                                             |                     |
| N                                             | Parsed, ignored                                                                                                                                                         |                     |
| E                                             | Treated as a fourth **axis** (extruder), and swallows exponents (R6)                                                                                                    | not an RS274 axis   |
| A, B, C, D, O, `/`, `*`                       | **Whole line fails** (R7, R8)                                                                                                                                           |                     |

**Order of execution** is **line order**, not RS274's defined order. Within a line:
F is set first (`:487-489`), then each G word is applied in the order written
(`:492-523`), then the motion runs (`:524-525`). Two consequences:

- **The F word is converted by the unit mode in force _before_ the line**, so
  `G20 G1 X1 F10` feeds at 10 mm/min instead of 254 (N2).
- A non-modal code (G10) runs **mid-loop**, before G words that follow it on the same
  line.

## 5. Motion

- **Lines** (`parser.js:143-147`, `:171-183`). A move is dropped, **and the position is
  not advanced**, unless some axis changes by more than 10 µm (`> 0.00001`, `:174`).
  So a run of sub-10 µm moves collapses entirely (R9). Zero-length moves vanish too.
- **Work offsets and incremental mode** (`:292-299`). The current work offset is added to
  every commanded axis **before** the distance mode is applied. In G91, the offset is
  therefore added to each _increment_ (R5: 101, 202, 303).
- **Arcs** (`:185-262`, maths credited to grbl). Two notations:
  - **I/J/K (centre).** Missing components default to 0. With neither present, the code
    throws "no center", which is caught and reported.
  - **R.** `mightyFactor = -√(4R² − dx² − dy²) / √(dx² + dy²)`. **No check that the
    radicand is ≥ 0**, so an impossible arc gets a NaN centre and draws nothing, with no
    error (R2). A full circle in R format divides by zero and gives NaN too.
  - Sweep comes from `atan2`, then is normalised to `(−2π, 0)` for CW and `(0, 2π)` for CCW,
    so a start = end I/J arc is a correct full circle.
  - **An arc with no axis words returns silently** (`:224-225`), which drops a legitimate
    full circle such as `G2 I-5` (R3).
  - **Helical** arcs interpolate the third axis linearly (`simulation.js:54`).
  - **Planes**: the transposer maps first/second/last coordinates (`:31-52`), which is
    correct for G17, G18 (ZX) and G19.
- **Units**: G20 multiplies lengths by 25.4 via `unitMode` (`:108`), and so does F, but
  with the ordering bug above (N2).

## 6. The time estimate (the simulator)

`simulation.js`. The model that produces upstream's time, confirmed to 1 µs against
hand calculation (N11's test):

1. **Constants.** Acceleration **200 mm/s²**, hard-coded (`:237`). Feeds come from the
   parser: capped at **3000 mm/min**, with rapids at 3000 mm/min (R10, N9).
2. **Grouping** (`:214-234`). Consecutive fragments join a group while
   `|exitDir₁ + entryDir₂| ≥ 1.95` (`:80-83`), that is, while the direction changes by
   less than about **25.7°** (for unit vectors, `|a+b| ≥ 1.95` means a turn under 2·acos(0.975) = 25.68°). Every group boundary is a **full stop** (R10).
3. **Per segment**: `speed = feed/60`. For arcs, the speed is limited so that centripetal
   acceleration stays at or below 0.8 × 200 mm/s², and the remaining acceleration budget is
   tangential (`arcClampedSpeed`, `:68-78`).
4. **Planning** (`planSpeed`, `:109-170`). Forward and backward passes limit each
   segment's squared speed by what can be reached from its neighbours
   (`v² ≤ v₀² + 2·a·d`), then a trapezoidal (or triangular) profile is laid out per
   segment. Inside a group, junctions are assumed continuous: there is **no junction
   speed limit** between segments of the same group.
5. **Clock** (`simulate2`, `:236-270`). The time is sampled at discretisation points: 40
   per line and **`round(|sweep| / 2π × 50)` per arc** (`:57-59`). An arc under
   about 3.6° gets **zero** steps, so it contributes **no time and no bounding box**.
   The estimate can even go **down** when such an arc is added (N7, worse than R11 as
   listed). The mechanism: joined to the preceding line in the same group, the arc means
   the line no longer decelerates to zero at its end. That deceleration now happens inside
   the arc, which is never sampled, so its time is lost. For example, a 100 mm line alone
   is 10.060 s; with a 0.57° or 3.0° arc appended it is 10.035 s; with a 4.0° arc (above the
   boundary) it is 10.759 s.
6. **Fixed overhead.** Each group ends with 10 samples of +1 ms, which adds **10 ms per
   stop** (`:265-268`, N11).
7. **Not modelled at all**: dwells (N8), tool changes, spindle spin-up, M0 pauses,
   program start, controller block rate, per-axis limits, and machine rapid rate.

**Consequence for quoting.** Upstream's time is not a machine estimate. It is a
fixed-parameter kinematic sketch that stops at every corner over about 26°, caps every
feed at 3000 mm/min, ignores dwells and tool changes, and loses small arcs. On
arc-fitted CAM output, the last of these makes it _under_-estimate. It must not be used
for pricing. Phase 5 replaces it with a calibrated, per-machine model (plan §4.3).

## 7. Bounding box

`collectToolpathInfo` (`simulation.js:293-305`) builds the box from the **simulator's
discretisation points**, not from exact geometry. Two consequences:

- Arcs are sampled at 50 points per circle, so the box under-reports by
  `r·(1 − cos 3.6°)` ≈ 0.2 % of the radius, and arcs under 3.6° are missing entirely
  (R11, N7).
- **The box always includes the origin.** `simulate2` pushes `(0,0,0)` first
  (`:259`), whatever the start position (N1). A job that runs entirely at X100–X200
  reports a minimum X of 0.

## 8. Display pipeline (summary; the Phase 3 viewer replaces it)

- **Tessellation** (`gcodeSimulation.js:17-26`): each arc is split into
  `ceil(π / acos(1 − 0.001/r) · |sweep| / 2π)` steps, which is a **1 µm chord tolerance**.
  This is visually exact and worth keeping.
- **Chunking**: `util.js` packs points into `Float32Array` fragments of up to 10,000
  floats (3,333 points), split whenever `speedTag` changes. `threeDView.js:110` rebuffers
  into 20,000-point `LineSegments`. Float32 keeps about 0.1 µm resolution at metre
  scale, which is enough.
- **3D** (`threeDView.js`): feed in white and rapids in red. **Rapids are drawn in an
  overlay scene with depth cleared, so they always appear on top** (R12). `linewidth` is
  ignored by WebGL (1 px). Uses `Geometry`, `MultiMaterial` and `addAttribute`, which
  are removed in current three.js (R14).
- **2D** (`twoDView.js`): SVG.js top-down view with an adaptive mm/cm/dm grid.
- **Editor sync**: `lineSegmentMap[lineNo]` maps each source line to its drawn points,
  which drives the line ↔ path highlight in both views. Keep this UX (plan §2.3).

## 9. Benchmarks

`node tools/bench-legacy.cjs`, Node 22.23.2, Xeon Gold 6148 @ 2.4 GHz, median of 5 runs.
"Simulate" is `simulateGCode()`, which includes a second parse, tessellation and planning.

| File                                                                                |   Lines |    Parse | Simulate |
| ----------------------------------------------------------------------------------- | ------: | -------: | -------: |
| tux.ngc                                                                             |   4,297 |    35 ms |   202 ms |
| test_pycam.ngc                                                                      |  33,445 |   165 ms | 1,217 ms |
| webgcode.ngc                                                                        |  45,823 |   254 ms | 1,714 ms |
| aztec_calendar.ngc                                                                  | 223,857 | 1,379 ms | 9,162 ms |
| a 1,197-line production job (private corpus; not reproducible from this repository) |   1,197 |    10 ms |    69 ms |

**Implication for Phase 2.** Upstream already _parses_ the 224k-line file in 1.4 s on
this machine, so the plan's Phase 2 target ("aztec parses ≤ 2 s in Node") is not
demanding. The rewrite does more per line (a line model with source spans), so the
target is still a real guard against regression. A stricter target, such as
parse + interpret ≤ 2 s, would be the meaningful one. **Rendering was not benchmarked
here.** That needs a headless browser, and it moves to Phase 3, where one is installed
anyway (operator decision 2026-09-25).

## 10. New findings (not in plan §2.2)

Every row is pinned by `tools/legacy-findings.test.cjs`.

| ID  | Finding                                                                    | Where                       | Effect                                             | Severity                 |
| --- | -------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------ |
| N1  | The simulated bounding box always includes the origin                      | `simulation.js:259`         | Box wrong for any job not spanning the origin      | Medium                   |
| N2  | F on the same line as G20 is converted with the _previous_ units           | `parser.js:487-489`         | Feed 25.4× too slow on that line                   | Medium                   |
| N3  | Repeated words: F uses the first value, axes use the last                  | `parser.js:489`, `:158`     | Inconsistent; should be an error                   | Low                      |
| N4  | Bare-CR line endings: the whole file is one line                           | `parser.js:540`             | Silent, completely wrong path                      | High (for CR files)      |
| N5  | G53: error reported, then the move runs in work coordinates                | `parser.js:517-525`         | Machine-coordinate moves land in the wrong place   | Medium                   |
| N6  | G28/G30: error reported, then the move runs as an ordinary move            | same                        | Home/return drawn as a plain move                  | Medium                   |
| N7  | Arcs under 3.6°: no time, no bounding box, and the estimate can _decrease_ | `simulation.js:57-59`       | **Under-estimates arc-fitted CAM output**          | **High (for estimates)** |
| N8  | G4 dwell adds no time                                                      | `parser.js:63`              | Under-estimate                                     | Medium                   |
| N9  | Rapids at the 3000 mm/min cap                                              | `parser.js:282`, `:531-538` | Rapid time is wrong for any real machine           | Medium                   |
| N10 | No F ever given: feed is 200 mm/min, with no warning                       | `parser.js:281`             | Silent assumption                                  | Medium                   |
| N11 | +10 ms fixed per stop                                                      | `simulation.js:265-268`     | Small systematic bias                              | Low                      |
| N12 | M/S/T ignored, including M2/M30 program end (with R8)                      | grammar                     | No tool changes, spindle or end                    | Medium                   |
| N13 | Trig functions use radians; RS274/NGC uses degrees                         | `parser.js:330-347`         | Silent wrong geometry in any trig-computed program | High (for such programs) |
| N14 | MOD takes the dividend's sign; ROUND rounds halves up                      | `parser.js:368`, `:338`     | Differs from LinuxCNC on negative operands         | Low                      |
| N15 | An undefined named parameter reads as 0                                    | `parser.js:325`             | A misspelt `#<name>` goes unnoticed                | Medium                   |

## 11. Silent-failure inventory

These are cases where upstream produces a wrong or incomplete result **and reports
nothing**. The Phase 2 rule (plan §4.2 item 4) is that each becomes a diagnostic:

R2 impossible or full-circle R arc · R3 arc without axis words · R5 offset re-added in
G91 · R6 exponent read as an E axis · R8 moves after M2/M30 · R9 sub-10 µm moves dropped
· R11 bounding-box under-report · N1 origin in the box · N2 F units · N3 repeated words
· N4 bare CR · N7 small arcs lost from time and box · N8–N10 time-model assumptions ·
N12 ignored M/S/T · N13 trig in radians · N14 MOD/ROUND semantics · N15 undefined
named parameters read as 0.

Reported but still wrong (an error, and then the wrong motion anyway): R4 canned
cycles · R7 unsupported words · G40–42 · N5 G53 · N6 G28/G30. Fatal: R1 (stack overflow,
and the page hangs).

## 12. Keep / fix / drop

| Behaviour                                                                    | Decision      | Why                                                                                         |
| ---------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| I/J and ±R arc maths (grbl), sweep normalisation, full circles by I/J        | **Keep**      | Correct; goldens `ok-*-arcs`, `ok-r-arcs-minor-major`                                       |
| Plane transposer incl. G18 ZX order                                          | **Keep**      | Correct; `ok-planes`                                                                        |
| Helical interpolation                                                        | **Keep**      | Correct; `ok-helical`                                                                       |
| G20/G21, G90/G91, G54–G59.3, modal carry-over                                | **Keep**      | Correct; `ok-*` goldens                                                                     |
| Comments, `N`, trailing- and leading-dot decimals, no-space lines, lowercase | **Keep**      | Correct                                                                                     |
| `#n` and `#<name>` parameters, operator precedence, assignment-after-line    | **Keep**      | Correct per RS274                                                                           |
| 1 µm display tessellation; Float32 chunking                                  | **Keep**      | Visually exact, fast                                                                        |
| Line ↔ path editor highlight                                                 | **Keep** (UX) | Plan §2.3                                                                                   |
| R1 expression recursion and `$.each` function registration                   | **Fix**       | Diagnostic, never a hang                                                                    |
| R2 / R3 arc edge cases                                                       | **Fix**       | Diagnostic with a location; draw nothing silently never again                               |
| R4 canned cycles                                                             | **Fix**       | Expand G81–G89 to real motion (plan §4.2 item 2)                                            |
| R5 offsets in G91                                                            | **Fix**       | Apply offsets once, in absolute terms                                                       |
| R6 exponents / E axis                                                        | **Fix**       | No E axis for CNC dialects; an exponent is a diagnostic                                     |
| R7 A/B/C/D, unbalanced comments                                              | **Fix**       | Parse them; unsupported means a warning, and the line's other words survive                 |
| R8 unsupported codes, M2/M30, `/`, O-words, `*nn`                            | **Fix**       | Per dialect profile; M2/M30 end the program                                                 |
| R9 sub-10 µm drop                                                            | **Fix**       | Keep every move; flag degenerate ones                                                       |
| N2 F conversion order, and line-order execution in general                   | **Fix**       | RS274 order of execution                                                                    |
| N3 repeated words                                                            | **Fix**       | Diagnostic (repeating a word on one line is an RS274 error)                                 |
| N4 bare CR                                                                   | **Fix**       | Accept LF, CRLF and CR                                                                      |
| N5 / N6 G53, G28, G30                                                        | **Fix**       | Implement per dialect, or refuse the move with a diagnostic                                 |
| N12 M/S/T                                                                    | **Fix**       | Model spindle, tool change and program end as events                                        |
| N13–N15 trig units, MOD/ROUND, undefined names                               | **Fix**       | Degrees, with LinuxCNC semantics as the default. Every one is a per-dialect rule (ADR-0018) |
| R10, N7–N11 time model                                                       | **Drop**      | Replaced by the calibrated estimator (Phase 5)                                              |
| R11, N1 discretised bounding box                                             | **Drop**      | Exact geometry (plan §4.2 item 8)                                                           |
| E axis                                                                       | **Drop**      | 3D-printer legacy; not in scope                                                             |
| Ember/RequireJS/three.js-r73 views, Chrome app, firmware                     | **Drop**      | R14; rewritten in Phase 3, or out of scope                                                  |

## 13. Salvage review of the CAM code

Reviewed only enough to decide, as the plan asks.

- **`cnc/cam/3D/*` + `shaders/minkowski.frag`, `model_proj.*`** (about 1,200 lines):
  a GPU height-field engine that projects a model into a height texture and runs a
  Minkowski pass with a tool-profile texture. **Salvage candidate** for the roadmap's
  stock-removal simulation (plan §7 rank 19). Keep it reachable through git history and
  the `upstream-2025-09-18` tag; nothing to port now.
- `cnc/cam/{pocket,text,operations,toolpath,cam}.js`: 2D pocketing via Clipper and text
  via opentype. Full CAM is a non-goal. **Drop.**
- `cnc/controller`, `cnc/app`, `interpolator/`: USB machine control, the Chrome app shell
  and STM32 firmware. Non-goals. **Drop.**
- `cnc/import`, `cnc/maths`, `cnc/cad`: STL/SVG/Gerber import and supporting maths for
  the CAM. **Drop** with the CAM.
