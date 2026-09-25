<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# Changesets

Any PR that changes a publishable package adds a changeset (`pnpm changeset`),
which records the semver bump and the changelog line. Releases are cut from these and
tagged `v0.x.y` (plan §3.1).
