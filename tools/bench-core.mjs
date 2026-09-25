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
//   node tools/bench-core.mjs --ci            machine-independent budget check (CI)
//
// --ci: absolute times on a CI runner mean nothing against a target set on the
// reference machine, so CI checks a RATIO instead. The yardstick is upstream's own
// parser on aztec, measured on the same runner in the same job. On the reference
// machine the 2 s target is 1.45x upstream's parse time (2000 / 1379 ms, ANALYSIS
// §9), so CI fails if core parse + interpret exceeds 1.45x the yardstick. The
// budget therefore can't be spent silently (reviewer, toolkit #10).
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parse, interpret } = await import(join(root, 'packages/core/dist/index.js'));

const ci = process.argv.includes('--ci');
const args = process.argv.slice(2).filter((a) => a !== '--ci');
const runs = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : ci ? 5 : 10;
const files = args.length ? args : ci ? [] : [join(root, 'fixtures/upstream/aztec_calendar.ngc')];
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
if (ci) {
  const BUDGET_RATIO = 2000 / 1379;
  const { createRequire } = await import('node:module');
  const { load, workerDollar } = createRequire(import.meta.url)('./legacy-harness.cjs');
  const text = readFileSync(join(root, 'fixtures/upstream/aztec_calendar.ngc'), 'utf8');
  const program = parse(text);
  let legacy = Infinity;
  let core = Infinity;
  const quiet = console.log;
  for (let k = 0; k < runs; k++) {
    const m = load(workerDollar);
    console.log = () => {};
    let t = performance.now();
    m.parser.evaluate(text, null, null, null, []);
    legacy = Math.min(legacy, performance.now() - t);
    console.log = quiet;
    t = performance.now();
    parse(text);
    interpret(program);
    core = Math.min(core, performance.now() - t);
  }
  const ratio = core / legacy;
  console.log(
    `budget: core ${core.toFixed(0)} ms / upstream parse ${legacy.toFixed(0)} ms = ${ratio.toFixed(2)}x (limit ${BUDGET_RATIO.toFixed(2)}x)`,
  );
  if (ratio > BUDGET_RATIO) {
    console.error('::error::core is over its performance budget (ADR-0014)');
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
