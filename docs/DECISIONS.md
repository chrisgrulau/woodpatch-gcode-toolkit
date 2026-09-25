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
  retired. A per-library audit (38 libraries,
  [`docs/legacy-libraries.md`](legacy-libraries.md)) records each library's real SPDX
  identifier: MIT, BSD-2-Clause, BSD-3-Clause, BSL-1.0, ISC, OFL-1.1, and
  MIT-or-BSD-3-Clause for RequireJS. All are permissive. One file can't be pinned
  down: `yenc.js`, whose author declared only "BSD" and shipped no text
  (`LicenseRef-yenc-BSD-unspecified`). The audit table is the single source
  (`tools/data/legacy-libs.json`); a generator writes both `REUSE.toml` and the doc,
  and CI fails if either drifts from it. Nothing may be copied from `libs/` into the
  toolkit's packages without first checking that library's entry.
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
