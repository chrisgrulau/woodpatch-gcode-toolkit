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
