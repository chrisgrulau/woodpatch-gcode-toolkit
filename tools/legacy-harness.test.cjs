// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Smoke test: after the monorepo restructure, upstream's parser still loads
// headless from legacy/, and two verified defects still reproduce exactly as
// plan §2.2 recorded them. Phase 1's golden corpus builds on this harness, so
// CI should notice immediately if it stops loading.
//
// These assertions pin upstream's WRONG behaviour on purpose. They are
// characterisation, not a specification: the Phase 2 rewrite fixes R1 and R2,
// and its own tests assert the fixed behaviour.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, workerDollar, jqDollar } = require('./legacy-harness.cjs');

function run(dollar, src) {
  const m = load(dollar);
  const errors = [];
  m.parser.evaluate(src, null, null, null, errors);
  return errors;
}

for (const [flavour, dollar] of [
  ['worker $', workerDollar],
  ['jQuery $', jqDollar],
]) {
  test(`${flavour}: a plain program parses without errors`, () => {
    assert.deepEqual(run(dollar, 'G21 G90\nG0 Z5\nG1 X10 Y10 F300\nG2 X20 Y0 I5 J-5\nM30'), []);
  });

  test(`${flavour}: R1, a malformed bracket expression recurses until the stack overflows`, () => {
    assert.throws(() => run(dollar, 'G1 X[FOO]'), RangeError);
  });

  test(`${flavour}: R2, an impossible R-format arc is dropped with NO error`, () => {
    // Chord 20 > 2R = 10, so no arc exists. Upstream reports nothing.
    assert.deepEqual(run(dollar, 'G1 X10 F100\nG2 X30 Y0 R5\nG1 X40'), []);
  });
}
