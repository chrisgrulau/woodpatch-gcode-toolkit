<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# Architecture decision records

One entry per decision: context, the decision, and its consequences. Entries are
never deleted. A reversed decision gets a new entry that supersedes the old one, and
the old one is marked as superseded.

Status values: **Accepted** · **Pending** (proceeding on a stated default, isolated so
it can be reversed) · **Superseded by ADR-NNNN**.

---

## ADR-0001: Licence: elect the MIT arm of upstream's dual licence

**Status:** Accepted, 2026-09-22.

**Context.** Upstream webgcode is offered by Nicolas Raynaud under **MIT or AGPL-3.0**,
in a single licence file. Under a dual licence the recipient chooses. An earlier draft
of the programme plan assumed AGPL-3.0, with a separate MIT arrangement for internal
use. That split turned out to be unnecessary once the licence file was read directly.

**Decision.** Distribute this project under **MIT**.

- `LICENSE`: the MIT text verbatim, carrying both copyright lines (Nicolas Raynaud
  2016; this project 2026). The election is explained in `NOTICE`, never inside the
  permission notice.
- `LICENSE.txt`: upstream's own dual-licence file, **byte-identical and at its
  original path**. It arrived with the fork's history. A second copy (a planned
  `LICENSE.upstream`) was deliberately not added, because two files would give two
  answers to "which one is upstream's?". CI checks its SHA-256.
- `NOTICE`: upstream, author, fork point, the election, and the built-artefact rule
  (ADR-0009).

**Consequences.** There is no copyleft and no network-use source-offer obligation. A
visible "Based on webgcode by Nicolas Raynaud" credit is courtesy rather than a
requirement, and `@woodpatch/gcode-core` exports it as `ATTRIBUTION` so every surface
uses the same wording. The obligation that does remain is MIT's notice condition,
which ADR-0009 enforces mechanically. No CLA is needed (ADR-0008).

## ADR-0002: Copyright holder

**Status:** Accepted, 2026-09-24.

**Decision.** New work is `Copyright (c) <year> Promotional Notions Pty Ltd trading as
Woodpatch House & Garden`, which is the legal entity followed by its trading name. It
appears in `LICENSE`, `NOTICE` and each file's `SPDX-FileCopyrightText`. Upstream
files keep `Nicolas Raynaud`.

## ADR-0003: Stack

**Status:** Pending (proceeding on the default).

**Default.** pnpm workspace monorepo; TypeScript in strict mode; `core` has zero
runtime dependencies and runs in Node, browsers and workers; viewer on current
three.js; editor on CodeMirror 6; Svelte 5 components for host apps; a small Node HTTP
service for server-side estimates; Vitest; esbuild for package builds; Changesets for
releases.

**Isolation.** Host frameworks sit at the edge. `core`, `viewer` and `editor` are
framework-free, and only `svelte` depends on Svelte, so changing the host framework
replaces one thin package.

## ADR-0004: Repository name and home

**Status:** Accepted, 2026-09-22.

**Decision.** `chrisgrulau/woodpatch-gcode-toolkit`, a GitHub **fork** of
`nraynaud/webgcode`, so that the "forked from" relationship and the full upstream
history carry through. `main` is cut from upstream `gh-pages` HEAD (`d315a359`), tagged
`upstream-2025-09-18`. Upstream's `gh-pages` and `master` are left untouched.
`upstream` is kept as a git remote. History is never force-pushed.

## ADR-0005: Park upstream under `legacy/`; licensing scope for it

**Status:** Accepted, 2026-09-24.

**Context.** Only about 1,000 lines of upstream (the parser, planner and viewer core)
matter to this project, and they are being rewritten rather than ported. The rest is
CAM, USB machine control and STM32 firmware. Upstream also vendors about 218 files of
third-party libraries in `webapp/libs/`, and about 70 of them carry no licence header.

**Decision.**

- The whole upstream tree moves under `legacy/` via `git mv` in one PR with no content
  edits, so `git log --follow` keeps working. `legacy/` keeps its internal layout, so
  the old simulator's relative paths and the Phase 1 harness still work.
- `legacy/` is **never built, linted, bundled, published or served**. It stays for
  one release as a reference and is then deleted. Git history and the
  `upstream-2025-09-18` tag preserve it regardless.
- **Licensing records** (`REUSE.toml`): upstream's own files are annotated
  `MIT OR AGPL-3.0-only`, © 2016 Nicolas Raynaud. The vendored libraries in
  `legacy/webapp/libs/**` are redistributed as received, each under its own licence.
  _Amended 2026-09-25:_ the Phase 0 placeholder `LicenseRef-legacy-vendored` is
  retired. A per-library audit ([`docs/legacy-libraries.md`](legacy-libraries.md): 38
  top-level entries grouped into 34 rows) records each library's real SPDX identifier:
  MIT, BSD-2-Clause, BSD-3-Clause, BSL-1.0, ISC, OFL-1.1, and MIT-or-BSD-3-Clause for
  RequireJS.
  - **Four Ace modes were removed**: `mode-r`, `mode-rdoc`, `mode-rhtml` and `mode-tex`.
    They are RStudio's contributions to Ace, under **AGPL-3.0-only** with no
    permissive alternative. Nothing loads them; the only mode upstream sets is
    `javascript`. This is a deliberate, recorded deviation from "as received". The
    files remain in history and at the upstream tag.
  - Flot's resize plugin is dual MIT/GPL, and **MIT is elected**. That's recorded as an
    election in the table.
  - With those two handled, every file in the tree is under a permissive licence.
  - One file can't be pinned down: `yenc.js`, whose author declared only "BSD" and
    shipped no text (`LicenseRef-yenc-BSD-unspecified`).

  The audit table is the single source (`tools/data/legacy-libs.json`). A generator
  writes both `REUSE.toml` and the doc, and CI fails if either drifts from the table.
  **The same check reads every covered file's header** and fails on a GPL-family
  notice that the table doesn't account for. That is how the four Ace modes should
  have been caught the first time, and it's mutation-tested. Nothing may be copied from
  `libs/` into the toolkit's packages without first checking that library's entry.

- The one planned consumer is `tools/legacy-harness.cjs`. It loads
  `libs/jsparse.js` (Chris Double, BSD-style licence per its header) at test time
  only.

**Alternative rejected.** Deleting `libs/` apart from `jsparse.js` now. That would
make the licensing trivially clean, but it breaks the legacy simulator, which Phase 1
needs to benchmark upstream rendering.

## ADR-0006: CI on GitHub-hosted runners, with no third-party actions

**Status:** Accepted, 2026-09-24.

**Context.** The repository's Actions policy permits only actions defined in the
owner's own repositories, pinned to full commit SHAs, so `actions/checkout` and
`actions/setup-node` are unavailable. The repository is public.

**Decision.**

- **GitHub-hosted runners only.** A self-hosted runner on a public repository would
  execute arbitrary fork-PR code on our own infrastructure.
- **No `uses:` steps.** Checkout is a few lines of `git`. Node and pnpm are downloaded
  by `.github/ci/setup-toolchain.sh` and verified against hashes **pinned in that
  file** (not against checksums fetched from the same server). Bumping a tool
  version means bumping its hash in the same commit.
- `permissions: contents: read`. Event values reach shell through `env`, never
  through `${{ }}` interpolation into script text.
- One tool is version-pinned but not hash-pinned: `reuse`, run via
  `pipx run 'reuse==6.2.0'`. That is accepted because its blast radius is its own
  job, which has `contents: read`, no secrets and no artefact output. Hash-pin it
  (`--require-hashes`) if that job ever gains write access or produces output
  anything else consumes.
- The jobs (`checks`, `reuse`, `provenance`) are the required status checks on `main`.
  Renaming a job means updating branch protection.

## ADR-0007: Dependency supply-chain safeguards

**Status:** Accepted, 2026-09-24.

**Decision.**

- `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`: no dependency version younger
  than 7 days is resolved. Most malicious npm releases are detected and pulled within
  that window.
- Dependency install scripts are blocked (pnpm's default). Each exception is listed
  in `allowBuilds` with the reason. The only one so far is `esbuild: false`: its
  script only swaps in a native binary for startup speed, and esbuild works without
  it.
- Exact tool versions: pnpm via `packageManager`, and reuse pinned in CI. The
  lockfile is always installed `--frozen-lockfile`.
- TypeScript is pinned to `~6.0` because `typescript-eslint` does not yet support
  TypeScript 7. Revisit when it does.

## ADR-0008: DCO sign-off instead of a CLA

**Status:** Accepted, 2026-09-24.

**Context.** A CLA was planned under the AGPL assumption, so that contributions could
be relicensed for internal use. Under MIT (ADR-0001), inbound and outbound licences
are the same.

**Decision.** Every PR commit carries `Signed-off-by:` matching its author
([DCO](https://developercertificate.org)). `.github/ci/check-dco.sh` enforces it in
the `provenance` job.

## ADR-0009: MIT's notice travels with built artefacts, enforced in CI

**Status:** Accepted, 2026-09-24.

**Context.** MIT's single condition is that its copyright and permission notice be
included in "all copies or substantial portions of the Software". For a browser
toolkit, the realistic way to break that is a bundler or minifier stripping the
header. The GitHub "forked from" badge is attribution, not a notice.

**Decision.**

- `scripts/build-package.mjs` prepends a `/*! … */` legal banner to every package's
  built entry. It is **generated from `LICENSE` itself**, so it cannot drift, and
  carries both copyright lines, the permission notice and the upstream credit.
- Every publishable package declares `"license": "MIT"` and ships `LICENSE` and
  `NOTICE`, copied from the root at build time.
- `scripts/check-package-licences.mjs` (CI, `checks` job) fails unless all of the
  following hold:
  - the manifest is right;
  - the copies are byte-identical to the root;
  - `npm pack` would include them;
  - the built entry starts with the banner;
  - the banner survives a **minified consumer bundle** under both of esbuild's
    legal-comment-preserving modes.
- The check requires the permission-notice text, not only the name "Nicolas
  Raynaud". The name also appears in `ATTRIBUTION`'s data, so a bare name grep would
  pass even with the notice stripped. A negative test confirmed this.

**Consequences for consumers.** Vite's production build drops legal comments by
default. Any app that bundles these packages must opt in (for example esbuild
`legalComments: 'inline'` or `'eof'`) and should grep its own build output the same
way.

## ADR-0010: The workspace root is not an ES-module package

**Status:** Accepted, 2026-09-24.

**Context.** With `"type": "module"` in the root `package.json`, Node loads
upstream's CommonJS/AMD files under `legacy/` as ES modules. `require()` then returns
a frozen module namespace, and the legacy harness fails when jsparse tries to set
`memoize`.

**Decision.** The root `package.json` has no `"type"`. Root-level ESM files use
`.mjs`, and CommonJS tooling uses `.cjs`. Packages under `packages/` declare
`"type": "module"` themselves.

## ADR-0011: The programme plan is not kept in this repository

**Status:** Accepted, 2026-09-24.

**Context.** The original plan asked for a copy of itself in the repo as
`docs/PLAN.md`. That plan is an internal document: it describes internal
infrastructure, business systems and commercial processes. This repository is public.

**Decision.** The plan stays internal and is **not** kept here. This file (the ADR log)
is the public record of decisions and their reasons, and the README describes status
and layout. The same rule applies to everything else committed here: package
descriptions, comments and docs name no internal hosts, systems or customers, and
refer to consumers only as "consuming applications". Customer G-code never enters
this repository or its history.

## ADR-0012: Characterisation goldens: what they record, and how big they may be

**Status:** Accepted, 2026-09-25 (operator chose "option C").

**Context.** Phase 2 rewrites upstream's parser. To show that every behaviour change is
deliberate, upstream's own output (bugs included) is recorded first, as _goldens_. A full
path for the large upstream samples would be about 46 MB (aztec alone is 34 MB), and
git keeps every version forever.

**Decision.**

- `tools/golden-legacy.cjs` runs upstream's parser and simulator (via
  `tools/legacy-harness.cjs`) over `fixtures/synthetic/` and `fixtures/upstream/`, and
  writes `fixtures/golden/legacy/**.json`. Each golden records:
  - the outcome (ok, or the thrown error's class);
  - upstream's reported errors;
  - its console output;
  - the simulator's bounding box and time;
  - the path, as compact tuples.
- **Size policy (option C).** A path of at most 10,000 segments is stored in full.
  Above that, the golden stores the summary, the first and last 200 segments, and a
  SHA-256 of the full canonical path. Any change to any segment is detected, and
  `--full <file>` prints the whole path locally for diagnosis. Total size is about
  590 KB, against about 46 MB for full paths.
- Numbers are rounded to 6 decimals and `-0` is normalised. NaN and ±Infinity are
  stored as strings, because upstream really produces them (R2).
- The worker `$` (what the live simulator ran) is the primary record. For synthetic
  cases, the jQuery-faithful `$` is also run and recorded only where it differs. Today
  that is R1 with `SIN`, exactly the root cause the plan identified.
- **CI regenerates every golden and fails on any difference**, so goldens change only
  through the reviewed generator. `tools/legacy-reference.test.cjs` checks the goldens
  against independently published reference measurements (error counts, bounding
  boxes, times) for all four upstream samples.

**Consequences.** Where upstream was right, Phase 2 must match these goldens; where it
was wrong, it must differ, and each difference is listed. Deleting or regenerating a
golden to make a test pass defeats the purpose, so the generator is the only writer.

## ADR-0013: Commit identity

**Status:** Accepted, 2026-09-25.

**Decision.** Keep the current commit identity. Squash-merges on `main` are authored by
the automation bot's GitHub no-reply address, and the branch commits' `Signed-off-by:`
lines keep the contributing role's address. Past history is not rewritten.

## ADR-0014: Phase 2 performance target is parse + interpret

**Status:** Accepted, 2026-09-26 (operator).

**Context.** The original target was "the 224k-line aztec sample parses in ≤ 2 s in
Node". Upstream already parses it in 1.4 s (ANALYSIS §9), so parse-only is barely a bar.

**Decision.** The target is **parse + interpret ≤ 2 s** for aztec_calendar.ngc on the
reference machine and pinned Node. After parcel 2a, the lossless tokenizer alone takes
about 0.84 s (872,824 tokens, 0 diagnostics), which leaves about 1.1 s for the
interpreter.

**Enforced in CI** (amended 2026-09-26, reviewer, toolkit #10). Absolute times on a CI
runner can't be compared with a target set on the reference machine, so CI checks a
**ratio**: core parse + interpret of aztec, divided by upstream's own parse of aztec, both
measured on the same runner in the same job (`node tools/bench-core.mjs --ci`). On the
reference machine the target is 2000 / 1379 ms = **1.45×**. After parcel 2c-1 the ratio is
about 1.3×, so the remaining budget is visible, and spending it fails the build.

_Measurement amended 2026-09-26 (toolkit 2c-2)._ The core's own time varies about ±10%
between measurements, because parsing aztec allocates about 2.6 million small objects and
the garbage collector's timing varies. Upstream's time is steady. So the gate:

- times each side in its own block, core first, with a forced collection before every
  run (`node --expose-gc`), keeping the minimum;
- retries a measurement that comes out over budget, up to 3 attempts, and fails only
  if all are over.

A real regression fails every attempt; noise rarely does. Every attempt is printed. The
lasting cure is fewer allocations: the path model (2d) avoids per-segment objects, and a
leaner token representation is the next lever if the budget stays tight.

_Ratcheted 2026-09-26 (reviewer, toolkit #11)._ The fast path never ran in 2c-2's first
cut: the G letter was missing from its table. The fix (203eab0) roughly halved the core's
time. The measurements:

| Where           | Before the fix | After       |
| --------------- | -------------- | ----------- |
| Locally (aztec) | about 1.6 s    | about 0.8 s |
| Locally (ratio) | —              | about 0.65× |
| CI (ratio)      | 1.38×          | 0.74–1.04×  |

The CI range is for near-identical code on different runners: upstream's own parse
alone ranged from 486 to 943 ms. So the ratio is less machine-independent than assumed
above.

The limit is now **1.2×**. That protects most of the gain and catches a slide back
towards the old 1.4×, without failing on runner variation. The cost is that on a
slow-ratio runner, a regression of up to about 15% can still pass.

A pass that needed a retry now prints a `::warning::` annotation, so creep shows on the
PR's checks and not only in a log nobody reads. The 2 s absolute target on the reference
machine is unchanged, and now has about 60% headroom.

## ADR-0015: Primary dialect is Masso G3, firmware v5.13

**Status:** Accepted, 2026-09-26 (operator).

**Decision.** The `masso-g3` dialect profile is built from Masso's published G-code
reference for **firmware v5.13**, the version in use. Every code on that list is either
implemented or produces a diagnostic, and none is silently ignored. A `generic` profile
sits alongside it. Masso differs from the LinuxCNC-style model in ways the core must
handle per dialect, not globally:

- Fanuc-style `M98`/`M99` subprograms rather than O-word `sub`/`call`;
- canned cycles G73 and G81–G83 only;
- G68/G69 coordinate rotation, G38.x probing and G54.1 extended offsets;
- machine-specific M-codes.

## ADR-0016: Cutter compensation is drawn uncompensated, with a warning

**Status:** Accepted, 2026-09-26 (operator).

**Decision.** In Phase 2, G41/G42 are recognised and tracked in the modal state, and
the path is drawn **uncompensated**. A warning on the G41/G42 line says so, and names
the D offset that was not applied. Real offset-path compensation goes on the roadmap.
CAM output rarely relies on controller compensation, and a clearly-labelled
uncompensated path is honest where a half-right offset would not be.

## ADR-0017: The lossless line model

**Status:** Accepted, 2026-09-26.

**Decision.** The syntax layer (`packages/core/src/syntax/`) keeps each line's exact
text and line ending. Tokens hold only spans into that text.

- `write(parse(x)) === x` for **any** input. It is property-tested on arbitrary
  unicode and on every fixture.
- Edits splice text into spans (`editLine`), so every untouched byte survives.
- Spans are UTF-16 code-unit offsets (what JavaScript strings and CodeMirror use).
- Lines are numbered from **1**. Upstream's golden files use 0-based `lineNo`, and the
  parity ledger (parcel 2f) maps between them.
- LF, CRLF and bare CR are all line breaks, and each line records its own. A leading
  BOM is recorded and stripped. The final line always exists, even when it's empty,
  which matches editors.
- The syntax layer is **letter-agnostic**. `A`, `D` and `E` are simply words, and
  whether they mean anything is for the dialect and the interpreter. A bad character
  or an unterminated comment is reported and skipped, and the rest of the line is
  still read. Upstream dropped the whole line (R7).
- Whitespace outside comments is insignificant, including inside a number, per
  RS274/NGC. Upstream did the same. `X1 0` reads as `X10`, with an info diagnostic
  because it's unusual.
- `X1e3` reads as `X1` then an `E3` word, as in RS274, with a warning that
  G-code has no exponent notation (R6).
- Parsing never throws. `editLine` throws only on programming errors (overlapping
  edits, or an inserted line break).

## ADR-0018: Expression rules are per-dialect data; LinuxCNC is the verified default

**Status:** Accepted, 2026-09-26.

**Context.** Controllers disagree about how expressions evaluate, and upstream matched
none of them on several points (ANALYSIS §3, N13–N15).

**Decision.** `packages/core/src/expr/` parses and evaluates expressions under an
`ExpressionRules` object, so each dialect profile (parcel 2e) picks its rules instead of
the core hard-coding them. The rules cover:

- precedence levels;
- equality tolerance;
- angle unit;
- MOD sign;
- ROUND halves;
- undefined named parameters;
- the maximum parameter number;
- the maximum nesting depth.

`LINUXCNC_RULES` is the default. **Each of its values was checked against LinuxCNC's
interpreter source, not recalled:**

| Rule                      | Value                                                         | Source                                                         |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Precedence                | `**` · `* / MOD` · `+ -` · `EQ NE GT GE LT LE` · `AND OR XOR` | LinuxCNC G-code overview, "Operators Precedence"               |
| Equality tolerance        | 1e-6, applied to **EQ, NE, GE and LE only**                   | `TOLERANCE_EQUAL` (`interp_internal.hh:89`); `execute_binary2` |
| GT and LT                 | **plain** `l > r` and `l < r`, with no tolerance              | `interp_execute.cc:156`, `:175`                                |
| Angle unit                | degrees                                                       | `sin(x·π/180)`, `asin(x)·180/π`                                |
| MOD                       | always positive                                               | `interp_execute.cc`: "always calculates a positive answer"     |
| ROUND                     | half away from zero                                           | `(int)(x ± 0.5)`                                               |
| Undefined named parameter | error                                                         | `interp_namedparams.cc:192`                                    |
| Numbered parameters       | 1–5601                                                        | `RS274NGC_MAX_PARAMETERS = 5602` is an array size              |
| Unary +/−                 | before any value                                              | `read_real_value`, `interp_read.cc`                            |
| NaN / ±∞ result           | error                                                         | `read_real_value`                                              |

A consequence worth knowing: for two values within the tolerance of each other but not
equal (say l = r + 5e-7), `EQ`, `GE`, `LE` **and** `GT` are all 1. That looks
inconsistent, but it's what LinuxCNC does. A tidier rule would not be faithful to the
controller, so a test pins the corner (reviewer, toolkit #9).

Evaluation never throws. Division by zero, domain errors, undefined or non-integer
parameters and non-finite results are diagnostics pointing at the responsible
sub-expression. Nesting beyond `maxDepth` (64) is a diagnostic rather than a stack
overflow, which fixes R1: its own example `[SIN[0]+10]` now simply evaluates to 10.

## ADR-0019: The interpreter's contract

**Status:** Accepted, 2026-09-26.

**Decision.** `packages/core/src/interp/` turns a parsed program into an ordered list of
`Step`s: linear moves, arcs, dwells, tool changes, spindle, coolant, pauses and the
program end.

- **Order of execution** within a line follows RS274/NGC as LinuxCNC documents it
  ("Order of Execution"), not the order the words are written. That includes **F
  before G20/G21**: `G20 G1 X1 F10` from G21 feeds at 10 mm/min, as in LinuxCNC
  (`execute_block` runs `convert_feed_rate` before `convert_length_units`). Controllers
  disagree on this line, so it's **dialect data** (`InterpreterRules.feedUnits`:
  `at-feed-step`, the LinuxCNC default, or `end-of-line`), and a line that changes units
  alongside an F word gets a **warning** either way. A redundant G21 in a CAM header
  doesn't warn. A feed set on an earlier line stays physically the same across a unit
  change, as in LinuxCNC. _Amended 2026-09-26 (reviewer, toolkit #10): the first draft
  used end-of-line units as the default, which is the opposite of LinuxCNC. Masso's
  behaviour is not yet known; see ADR-0015._
- **Positions are machine coordinates in millimetres.** Every move also carries the
  total work offset in force (coordinate system + G92/G52), so work coordinates are
  `position − offset`. G53, G10, G92 and coordinate-system changes then compose
  exactly, and a viewer can still draw in work coordinates.
- **Offsets live in LinuxCNC's parameter layout**, verified against its "Numbered
  Parameters" documentation. Programs that read or write them (`#5221` and so on) see
  consistent values:
  - G28 home #5161; G30 home #5181;
  - G92/G52 flag #5210 and offsets #5211;
  - active coordinate system #5220;
  - coordinate system _n_ at #5221 + 20(n−1).

  Values are stored in millimetres.

- **A line that can't be executed is reported, and its motion is skipped**, so the tool
  stays where it was (plan §4.2 item 4). That covers:
  - an unknown or not-yet-interpreted code;
  - two codes from one modal group;
  - a repeated word (N3);
  - a letter the dialect doesn't have (E: R6);
  - a syntax or evaluation error;
  - a feed move with no feed rate (upstream silently used 200 mm/min, N10);
  - axis words claimed by both a group-0 code and an explicit motion code.

  Upstream reported such lines and then moved anyway (N5, N6).

- **Words with no effect** on their line (`G1 X1 R5`) are a _warning_, and the line
  still runs. LinuxCNC treats this as an error. We're deliberately lenient, because the
  line's meaning is unambiguous.
- **G28/G30** rapid to the optional intermediate point, then to the stored position,
  for the named axes or for all of them. A program can't know the machine's real stored
  positions, so when it never set them (G28.1/G30.1) the machine origin is used, with
  an info diagnostic saying so.
- **Arcs are described, not resolved.** Each arc step carries its plane, direction, an
  I/J/K centre (absolute, machine coordinates) or a signed R, and P turns. Resolving
  the R-format centre and rejecting impossible arcs is the geometry layer's job
  (parcel 2d: R2). A centre-format full circle with no axis words is legal and runs,
  fixing R3.
- **Not simulated, and said so:**
  - cutter compensation (a warning; ADR-0016);
  - tool length offsets (info; no tool table);
  - coordinate-system rotation (a warning);
  - machine I/O M-codes (a warning).
- **Program end:** M2, M30 or a second `%` ends the program. Later lines aren't run, and
  one info diagnostic says how many were skipped (R8). The block-delete switch
  defaults to **on**, as on most controllers.
- **Diagnostics:** the interpreter reports its own findings (including expression
  errors). Syntax findings stay on the `Program`.
- **Recognised but deferred**, with an error that names the parcel:
  - canned cycles G73 and G81–G89 (2c-2), so a canned cycle is no longer drawn as a
    rapid plunge (R4);
  - O-words and M98/M99 (2c-3).

  Controller-specific tables are for the dialect profiles (2e).

**Performance.** aztec_calendar (224k lines) parses and interprets in about 1.68 s,
the minimum of 10 runs on the reference machine via `node tools/bench-core.mjs`,
against ADR-0014's 2 s target. The geometry layer (2d) has to fit in the remaining
headroom, so it will build its path model without per-segment objects.

## ADR-0020: Canned cycles follow LinuxCNC's source, with the dialect differences as data

**Status:** Accepted, 2026-09-26.

**Reference version: LinuxCNC 2.9.x** (stable, v2.9.10), per the reviewer on toolkit #11.
All of this ADR holds on the 2.9 branch and on master, except the peck distances below.

**Decision.** G73, G81, G82 and G83 (XY plane) are interpreted as LinuxCNC's
interpreter does them, from `interp_cycles.cc` (`convert_cycle_xy`, `CYCLE_MACRO`,
`convert_cycle_g73/g81/g82/g83`) rather than its prose docs. The docs say G73 ends at R;
the source retracts to the clearance plane.

- **Preliminary motion:** starting below R, Z rises to R once. Each repeat traverses XY
  (at the current height on the first repeat if above R, otherwise at the clearance
  plane), then rapids down to R.
- **Clearance plane:** R under G99. Under G98, the level when the run of cycles began
  (LinuxCNC `cycle_il`), raised to R if it was below. That level resets whenever an
  ordinary motion runs.
- **G90:** R and Z are work Z levels. **G91:** R is relative to that initial level, and
  Z is relative to R; X/Y step from the current position.
- **G81:** feed to Z, then rapid to clear. **G82:** the same, with a dwell. **G83:** feed
  Q, rapid out to R, then rapid down to `clearance` above the last depth, and repeat.
  **G73:** feed Q, then back off by `retract`, and repeat. Depths are counted from R.
- **Sticky values:** Z, R, Q and P carry over while the same cycle stays active. The
  first line of a cycle must have them.
- **Errors** (the line doesn't run): no R, Z, Q or P on a cycle's first line; R below Z;
  Q ≤ 0; zero feed; inverse-time feed; cutter compensation on; a plane other than XY;
  rotary axis words; a repeat count that isn't a positive integer.
- **G84–G89** are recognised and reported as not implemented. LinuxCNC has them; Masso
  doesn't.

LinuxCNC's two worked G81 examples (absolute, and incremental with L3) are tests,
checked move for move against its documentation.

**Controller differences are `InterpreterRules`** (the dialect profiles in 2e pick them):

| Rule                        | LinuxCNC (default)          | Masso G3 (docs and the 2026-09-26 machine test) |
| --------------------------- | --------------------------- | ----------------------------------------------- |
| `dwellUnits` (G4 and G82 P) | seconds                     | **milliseconds**                                |
| `cycleRepeat`               | `L`, stepping X/Y under G91 | **`K`, at the same position**                   |
| `g73Retract`                | 0.254 mm (0.010 in)         | **1.0 mm**                                      |
| `g83Clearance`              | 0.254 mm                    | not documented; the default applies             |

The machine test confirmed Masso's G83 retracts to R between pecks and ends at the
initial Z under G98, as modelled.

**LinuxCNC 2.10 differs on the peck distances.** In 2.9, `G83_RAPID_DELTA` (0.010 in,
0.254 mm under G21) is used for both G73 and G83. On master (2.10; commits c9759fc1b1
and 6dd181d7be):

- the defaults become 1 mm on a metric machine and 0.050 in on an inch one
  (`rs274ngc_pre.cc`);
- they can be set by INI `G73_PECK_CLEARANCE` / `G83_PECK_CLEARANCE`;
- they can be set per block by a **D word**.

A 2.10 profile must set `g73Retract`/`g83Clearance` itself rather than inherit 0.254.
It also needs D read as the peck distance on G73/G83; today D there is an unused word.

---

## ADR-0021: Subprograms and program flow

**Status:** Accepted, 2026-09-26.

**Reference version: LinuxCNC 2.9.x.** The 2.9 branch was checked against master.

- They agree on everything this ADR relies on: control-flow labels scoped per sub
  (`sub#label` in `read_o`), #1–#30 handling, and named-parameter scoping.
- The call limit is the same 9. 2.9 checks `call_level >= 10` after incrementing, and
  master checks `call_level + 1 >= 10` before.
- Master adds checks this doesn't depend on: stricter nested-definition errors inside a
  called file, and no forward-seek in a called file.

**Decision.** LinuxCNC's O-word flow and Masso's M98/M99 subprogram files are both
interpreted. They follow LinuxCNC's `interp_o_word.cc` and `interp_read.cc` where the
source and the docs (`o-code.adoc`) differ. Which one a controller has is dialect data.

**O-words (LinuxCNC).** `sub`/`endsub`/`return`/`call`, `if`/`elseif`/`else`/`endif`,
`while`/`endwhile`, `do`/`while`, `repeat`/`endrepeat`, `break`/`continue`.

- **Structure is matched once, up front** (`buildFlowIndex`), not by seeking through the
  file at run time as LinuxCNC does. The index is built the first time the interpreter
  meets an O-word, so a program without O-words pays nothing.
- **Scope:** subroutine labels are global across all loaded files. Control-flow labels
  are local to the subroutine body, or the main program, they're in. Labels are
  normalised: `o0100` is `o100`, and `<My Sub>` is `<mysub>`.
- **Calls:** up to 30 arguments go into #1–#30. Unpassed ones keep the caller's values,
  and the caller's #1–#30 are restored on return. Parameters above #30 are global.
- **Named parameters** are local to a call unless their name starts with `_`. That was
  already true of the main program.
- **Return values:** `endsub [v]` or `return [v]` sets `#<_value>` and
  `#<_value_returned>`. Both are cleared at the next call.
- **Truth:** a condition is true when non-zero. A `repeat` count is rounded, and 0 or
  less skips the body.
- **Forward calls:** a sub may be called before its definition in the main program. The
  docs forbid it; the source allows it (`control_back_to` step 3).
- **Definitions are skipped** in normal flow and run only when called.
- **Structure errors stop the run,** as LinuxCNC aborts: carrying on would run code that
  should be skipped, or skip code that should run. They are nested definitions,
  unmatched or reused labels, `else` after `else`, unclosed blocks, and `break`/`continue`
  outside a while or do loop. So do a missing or unevaluable condition, and an M99 ending
  an O-word sub.
- **Not yet interpreted:** `o[expr]` label indirection, which the tokenizer doesn't
  read, and Python O-word subs.

**Subprogram files.** The core never reads files. The caller passes
`resolveProgram({ kind, name })`, which returns the file's text or `undefined`.

- The call is synchronous: an async caller fetches first.
- Each file is asked for once and parsed once.
- LinuxCNC `o<name> call` asks for `o-word:<name>` and runs that file's `o<name> sub`.
- Masso `M98 P<n>` asks for `m98:<n>`: the number with no leading zeros, which is the
  Masso rule for file names.
- A missing file, or a resolver that throws, is reported, and the call is skipped.
- Steps and diagnostics from a file carry `file` (the resolver's name) and that file's
  own line numbers. `file` is absent for the main program, so existing consumers see no
  change.

**M98/M99 (Masso).** `M98 P<n> [L<runs>]` runs file n, L times (default once; `L0`
doesn't run it). #1–#30 are shared with the caller, not saved. The call runs after the
rest of its line. M99 returns. A file that ends without M99 returns with a warning.

- In the main program, M99 ends the drawing with a warning. LinuxCNC restarts the program
  forever.
- Under LinuxCNC rules, `M98 P<n>` means a numbered `O<n>` block in the same file (Fanuc
  style). That's reported as not interpreted yet, and the line is not run.

**Two kinds of limit, reported differently:**

| Limit                      | Whose            | Value                                        | Message                                |
| -------------------------- | ---------------- | -------------------------------------------- | -------------------------------------- |
| `subprograms.maxCallDepth` | the controller's | LinuxCNC 9, Masso 5                          | won't run on the machine; call skipped |
| `limits.maxCallDepth`      | ours (resource)  | 64                                           | stopped: too large to process          |
| `limits.maxLoopIterations` | ours             | 1,000,000 (while, do, repeat, M98 L)         | stopped                                |
| `limits.maxBlocks`         | ours             | 20,000,000 (each canned-cycle repeat counts) | stopped                                |

- **LinuxCNC's 9:** `INTERP_SUB_ROUTINE_LEVELS` is 10, but it counts the main program.
  `enter_context` refuses when `call_level + 1 >= 10`. A test runs 9 levels and refuses
  a 10th.
- **Masso's 5** is from its manual ("up to 5 levels of sub-program nesting"). It isn't
  tested on the machine yet, so it goes on the next machine test sheet.
- The resource limits are `InterpretOptions.limits`, so a server can tighten them.
- Canned-cycle repeats (`L`/`K`) now count against `maxBlocks` before any motion is
  built, so `G81 … L1000000000` can't exhaust memory.

**Found on the way: a sign before a parameter, bracket or function.** `X-#1`, `X-[…]`,
`X+SIN[…]` and `X--#1` are values in LinuxCNC (`read_real_value` negates what follows).
The 2a tokenizer rejected them, and subroutine code uses them constantly. The tokenizer
now reads them as an expression whose span includes the sign; the expression parser
already handled a leading sign. The lossless property is unaffected.

**The R8 O-word fixtures** now differ from upstream deliberately.
`r8-o-word-sub.ngc` draws its move to X10 with no diagnostics; upstream gave three
"did not understand line" errors and drew nothing. `r8-program-number.ngc` reads its
`O1000` without complaint. Tests pin both against the legacy goldens.

---

## Pending decisions

Each proceeds on its default and is listed in every PR that touches it.

| Decision                                          | Default until decided                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Stack (ADR-0003)                                  | As ADR-0003                                                                   |
| Where the estimate service runs                   | A private container beside the consuming backend; never public                |
| Source of truth for machine/tool/material records | Held by the consuming systems; the toolkit depends only on the schema         |
| Machine parameter values                          | Placeholders flagged `TODO(calibrate)`; uncalibrated is a representable state |
| Time-estimate accuracy target                     | ±5% after calibration                                                         |
