// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// The built playground must carry MIT's notice (ADR-0009): Vite drops legal comments
// by default, and this proves the config keeps them. Every JS chunk that contains
// toolkit code (the page and the worker) must name the upstream author and carry the
// permission notice. Fails the build otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist/assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
const need = ['Nicolas Raynaud', 'Permission is hereby granted, free of charge'];
// A chunk carries toolkit code if it has the toolkit's CSS classes (editor), the
// viewer's worker protocol, or the core's diagnostic codes. EVERY such chunk must carry
// the notice, not just one of them.
const TOOLKIT = [/gc-comment/, /SEMANTIC_[A-Z_]+/, /VIEW_SPAN_IMPLAUSIBLE/];
const bad = [];
let carriers = 0;
for (const f of js) {
  const text = readFileSync(join(assets, f), 'utf8');
  if (!TOOLKIT.some((r) => r.test(text))) continue;
  // The notice must be a /*! legal comment, not just a string that happens to match.
  const legal = [...text.matchAll(/\/\*![\s\S]*?\*\//g)].map((m) => m[0]);
  if (need.every((n) => legal.some((c) => c.includes(n)))) carriers++;
  else bad.push(`${f}: toolkit code without the MIT notice in a /*! comment`);
}
if (carriers === 0) bad.push('no chunk carries the MIT notice');
if (bad.length) {
  for (const b of bad) console.error(`::error::${b}`);
  process.exit(1);
}
console.log(`MIT notice present in all ${carriers} toolkit chunk(s) of ${js.length}`);
