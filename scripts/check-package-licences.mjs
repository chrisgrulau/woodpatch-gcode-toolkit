// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// CI gate: MIT's notice travels with every PUBLISHABLE package (ADR-0009).
// Run after `pnpm build`. For each non-private package under packages/:
//
//   - package.json says "license": "MIT" and lists LICENSE and NOTICE in `files`;
//   - the LICENSE and NOTICE copied into the package are byte-identical to the
//     repo root's (so a stale copy can't ship);
//   - `npm pack --dry-run` really includes LICENSE, NOTICE and the entry point;
//   - the built entry starts with the `/*!` banner, which names Nicolas Raynaud
//     and carries the permission notice;
//   - the banner SURVIVES a minified consumer bundle when legal comments are
//     preserved, which is the setting the consuming apps must use. Without this
//     step, "we added a banner" would be a claim nobody had tested.
//
// Exits non-zero, listing every failure, if anything is missing.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(repoRoot, 'packages');

// Strings that prove it is OUR notice, not just any comment.
const REQUIRED_IN_BUNDLE = ['Nicolas Raynaud', 'Permission is hereby granted, free of charge'];

const failures = [];
const fail = (pkg, msg) => failures.push(`${pkg}: ${msg}`);

const rootLicence = readFileSync(join(repoRoot, 'LICENSE'));
const rootNotice = readFileSync(join(repoRoot, 'NOTICE'));

let checked = 0;
for (const dir of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, dir);
  const manifestPath = join(pkgDir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (pkg.private) continue; // placeholders; they become publishable when they get code
  checked++;
  const name = pkg.name ?? dir;

  // ── Manifest ──
  if (pkg.license !== 'MIT')
    fail(name, `license is ${JSON.stringify(pkg.license)}, expected "MIT"`);
  for (const f of ['LICENSE', 'NOTICE']) {
    if (!pkg.files?.includes(f)) fail(name, `"files" does not list ${f}`);
  }

  // ── Copies are current ──
  for (const [file, root] of [
    ['LICENSE', rootLicence],
    ['NOTICE', rootNotice],
  ]) {
    const p = join(pkgDir, file);
    if (!existsSync(p))
      fail(name, `${file} missing from the package directory (did the build run?)`);
    else if (!readFileSync(p).equals(root)) fail(name, `${file} differs from the repo root copy`);
  }

  // ── What npm would actually publish ──
  const entry = pkg.exports?.['.']?.import;
  if (!entry) {
    fail(name, 'no exports["."].import entry point');
    continue;
  }
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )[0].files.map((f) => f.path);
  for (const f of ['LICENSE', 'NOTICE', entry.replace(/^\.\//, '')]) {
    if (!packed.includes(f)) fail(name, `npm pack would not include ${f}`);
  }

  // ── Banner on the built entry ──
  const entryPath = join(pkgDir, entry);
  if (!existsSync(entryPath)) {
    fail(name, `${entry} not built`);
    continue;
  }
  const built = readFileSync(entryPath, 'utf8');
  if (!built.startsWith('/*!')) fail(name, `${entry} does not start with a /*! legal banner`);
  for (const s of REQUIRED_IN_BUNDLE) {
    if (!built.includes(s)) fail(name, `${entry} does not contain "${s}"`);
  }

  // ── Survives a minified consumer build ──
  // `inline` and `eof` are the two esbuild modes that preserve legal comments.
  // Vite's production build drops them by default, which is why consuming
  // applications must opt in (ADR-0009).
  for (const legalComments of ['inline', 'eof']) {
    const out = await build({
      stdin: { contents: `export * from ${JSON.stringify(entryPath)};`, resolveDir: pkgDir },
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      legalComments,
      logLevel: 'silent',
    });
    const text = out.outputFiles.map((f) => f.text).join('\n');
    for (const s of REQUIRED_IN_BUNDLE) {
      if (!text.includes(s))
        fail(name, `minified bundle (legalComments=${legalComments}) lost "${s}"`);
    }
  }
}

if (checked === 0) failures.push('no publishable packages found; the check would pass vacuously');

if (failures.length) {
  console.error(`Licence notice check FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Licence notice check passed for ${checked} package(s).`);
