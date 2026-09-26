#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
# SPDX-License-Identifier: MIT
#
# Publishes the built playground to the `site` branch, which GitHub Pages serves
# (operator decisions on #1171). Plain git, no third-party actions (ADR-0006).
#
#   deploy-site.sh <dist-dir>        needs GITHUB_TOKEN (contents: write) and GITHUB_SHA
#
# `site` holds ONLY built output, one commit per deploy on top of the last (never a
# force-push). The upstream `gh-pages` branch is never touched: it's the fork reference.
set -euo pipefail

dist=${1:?usage: deploy-site.sh <dist-dir>}
test -f "$dist/index.html" || { echo "::error::$dist/index.html missing; build first" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"

git init -q "$work"
# SITE_REMOTE exists for testing the script against a local bare repository.
git -C "$work" remote add origin "${SITE_REMOTE:-https://github.com/${GITHUB_REPOSITORY}.git}"
if git -C "$work" -c http.extraheader="$auth" fetch -q --depth=1 origin site 2>/dev/null; then
  git -C "$work" checkout -q -B site FETCH_HEAD
else
  git -C "$work" checkout -q --orphan site # first deploy
fi

# Replace the whole tree with the new build.
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$dist"/. "$work"/
rm -f "$work"/assets/*.map # source maps stay out of the public site
touch "$work/.nojekyll"   # serve files as they are (no Jekyll processing)

git -C "$work" add -A
if git -C "$work" diff --cached --quiet; then
  echo "site unchanged; nothing to deploy"
  exit 0
fi
git -C "$work" \
  -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -q -m "site: deploy ${GITHUB_SHA}"
git -C "$work" -c http.extraheader="$auth" push -q origin HEAD:site
echo "deployed $(git -C "$work" rev-parse --short HEAD) for ${GITHUB_SHA}"
