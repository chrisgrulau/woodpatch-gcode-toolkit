#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
# SPDX-License-Identifier: MIT
#
# Developer Certificate of Origin: every non-merge commit in a PR must carry a
# `Signed-off-by:` trailer matching its author (ADR-0008). This takes the place
# of a CLA: the project is MIT in and MIT out, so contributors only need to
# certify they have the right to submit the work (https://developercertificate.org).
#
# Usage: check-dco.sh <base-sha> <head-sha>
set -euo pipefail

base="$1"
head="$2"
fail=0

for sha in $(git rev-list --no-merges "${base}..${head}"); do
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  if git log -1 --format='%(trailers:key=Signed-off-by,valueonly)' "$sha" | grep -Fqx -- "$author"; then
    echo "ok   ${sha:0:10} $author"
  else
    echo "::error::${sha:0:10} has no 'Signed-off-by: $author' trailer (use git commit -s)"
    fail=1
  fi
done

exit "$fail"
