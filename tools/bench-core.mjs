// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Measures the core against the Phase 2 performance target (ADR-0014): parse +
// interpret of aztec_calendar.ngc (224k lines) in 2 s or less. Reports the MINIMUM
// of N runs per stage, because the development machine is shared and a mean
// measures other people's load rather than this code. Needs a built core
// (pnpm build).
//
//   node tools/bench-core.mjs [runs=10] [file.ngc ...]
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parse, interpret } = await import(join(root, 'packages/core/dist/index.js'));

const args = process.argv.slice(2);
const runs = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 10;
const files = args.length ? args : [join(root, 'fixtures/upstream/aztec_calendar.ngc')];
const TARGET_MS = 2000;

console.log(`node ${process.version}, min of ${runs} runs per stage`);
let failed = false;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const program = parse(text);
  let p = Infinity;
  let i = Infinity;
  for (let k = 0; k < runs; k++) {
    let t = performance.now();
    parse(text);
    p = Math.min(p, performance.now() - t);
    t = performance.now();
    interpret(program);
    i = Math.min(i, performance.now() - t);
  }
  const total = p + i;
  const verdict = total <= TARGET_MS ? 'within' : 'OVER';
  if (total > TARGET_MS) failed = true;
  console.log(
    `${basename(f).padEnd(22)} ${program.lines.length} lines  parse ${p.toFixed(0)} ms  interpret ${i.toFixed(0)} ms  total ${total.toFixed(0)} ms (${verdict} the ${TARGET_MS} ms target)`,
  );
}
process.exitCode = failed ? 1 : 0;
