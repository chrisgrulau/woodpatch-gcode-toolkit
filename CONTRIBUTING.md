<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# Contributing

Thanks for your interest. Some ground rules keep the project's licensing and history clean.

## Sign off every commit (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org)
rather than a CLA. The project is MIT in and MIT out, so contributors only need to certify
that they have the right to submit their work under that licence. Sign each commit:

```sh
git commit -s
```

That adds `Signed-off-by: Your Name <you@example.com>`, which must match the commit's
author. CI rejects PR commits without it.

## Every file needs a licence header

New source files start with:

```ts
// SPDX-FileCopyrightText: <year> <copyright holder>
// SPDX-License-Identifier: MIT
```

Markdown uses an HTML comment with the same two lines. Files that cannot carry a comment
(JSON, lockfiles) are listed in `REUSE.toml`. CI runs `reuse lint` and fails on any file
without this information.

## Never modify upstream's licence or history

- `LICENSE.txt` is Nicolas Raynaud's own licence file for webgcode. It must never be
  edited, moved or deleted, and CI checks its hash.
- Never force-push over upstream history. `git log --follow` on files under `legacy/`
  must keep working back through upstream's commits.
- Do not copy code out of `legacy/webapp/libs/`. Those are third-party libraries
  that upstream vendored, each under its own licence, and they have not been audited.

## Workflow

Branches are `feat/<topic>`, `fix/<topic>` or `chore/<topic>`. Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org) (`feat(core): …`). PRs are
squash-merged into `main` once CI is green. Changes to a publishable package include a
changeset (`pnpm changeset`).
