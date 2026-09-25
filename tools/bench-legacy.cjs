// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Benchmarks upstream's parser and simulator headless in Node, to give the
// Phase 2 rewrite a baseline (plan §5 Phase 1). Reports the median of N runs.
// Note that upstream's simulateGCode() re-runs the parser internally, so
// "simulate" includes a second parse; that is how the live page worked.
//
//   node tools/bench-legacy.cjs [runs=5] [file.ngc ...]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load, workerDollar } = require('./legacy-harness.cjs');

const args = process.argv.slice(2);
const runs = /^\d+$/.test(args[0] || '') ? Number(args.shift()) : 5;
const files = args.length
  ? args
  : ['tux', 'test_pycam', 'webgcode', 'aztec_calendar'].map((n) =>
      path.join(__dirname, '../fixtures/upstream', n + '.ngc'),
    );

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const quiet = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};

console.log(`node ${process.version}, median of ${runs} runs`);
console.log(
  'file'.padEnd(22),
  'lines'.padStart(8),
  'parse ms'.padStart(10),
  'simulate ms'.padStart(12),
);
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const parse = [];
  const simulate = [];
  for (let i = 0; i < runs; i++) {
    const m = load(workerDollar);
    let t = process.hrtime.bigint();
    quiet(() => m.parser.evaluate(code, null, null, null, []));
    parse.push(Number(process.hrtime.bigint() - t) / 1e6);
    t = process.hrtime.bigint();
    quiet(() => m.gcodeSimulation.simulateGCode(code, new m.util.Point(0, 0, 0), () => {}));
    simulate.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  console.log(
    path.basename(f).padEnd(22),
    String(code.split(/\r?\n/).length).padStart(8),
    median(parse).toFixed(0).padStart(10),
    median(simulate).toFixed(0).padStart(12),
  );
}
