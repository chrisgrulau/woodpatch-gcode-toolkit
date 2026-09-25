// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// The goldens reproduce the reference measurements taken independently when
// upstream was first analysed (plan §2.4, verified 2026-09-22). This is what
// makes the goldens trustworthy: the harness that produced them matches an
// earlier, independent run of upstream, to the second and to the bounding box.
//
// Values are as published, so they are compared at the published precision.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const golden = (name) =>
  require(path.join(__dirname, '../fixtures/golden/legacy/upstream', name + '.json'));

const REFERENCE = [
  // name, error count, bbox [xmin,xmax,ymin,ymax,zmin,zmax] (published rounding), time s
  ['tux', 0, [0, 10, 0, 12.1, 0, 4], 473],
  ['webgcode', 0, [0, 223.09, -7.12, 20.52, -1, 3], 353],
  ['test_pycam', 1, [-12.5, 142.5, -4.5, 54.5, -10, 1], 12892],
  ['aztec_calendar', 2, [-202.1, 201.9, -202.5, 202.3, -12.9, 20.3], 11662],
];

const decimals = (x) => (String(x).split('.')[1] || '').length;
const near = (actual, published) => {
  const step = 10 ** -decimals(published);
  return Math.abs(actual - published) <= step / 2 + 1e-9;
};

for (const [name, errorCount, bbox, seconds] of REFERENCE) {
  test(`${name}: goldens match plan §2.4`, () => {
    const g = golden(name);
    assert.equal(g.outcome, 'ok');
    assert.equal(g.errors.length, errorCount, 'error count');
    const { min, max } = g.summary.simulatedBbox;
    const got = [min[0], max[0], min[1], max[1], min[2], max[2]];
    got.forEach((v, i) => assert.ok(near(v, bbox[i]), `bbox[${i}]: ${v} vs published ${bbox[i]}`));
    assert.equal(Math.round(g.summary.simulatedTotalTimeSeconds), seconds, 'time (s)');
  });
}
