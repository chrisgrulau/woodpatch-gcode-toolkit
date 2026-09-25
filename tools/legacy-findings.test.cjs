// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Upstream behaviours found during the Phase 1 analysis that plan §2.2 does not
// list (docs/ANALYSIS.md §10, N1–N12). Each test pins upstream's ACTUAL
// behaviour, so every claim in the analysis is proven in CI rather than asserted.
// The Phase 2 rewrite fixes most of these. Its own tests assert the fix; these
// stay as the record of what upstream did.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, workerDollar } = require('./legacy-harness.cjs');

function run(code, start = [0, 0, 0]) {
  const m = load(workerDollar);
  const errors = [];
  const log = console.log;
  console.log = () => {};
  try {
    const segs = m.parser.evaluate(code, null, null, null, errors);
    const sim = m.gcodeSimulation.simulateGCode(code, new m.util.Point(...start), () => {});
    return { segs, errors, time: sim.totalTime, min: sim.min, max: sim.max };
  } finally {
    console.log = log;
  }
}
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('N1: the simulated bounding box always includes the origin', () => {
  // Starts at (100,100,5) and never visits (0,0,0), yet min is (0,0,0).
  const r = run('G21 G90\nG1 X200 F600\n', [100, 100, 5]);
  assert.deepEqual([r.min.x, r.min.y, r.min.z], [0, 0, 0]);
});

test('N2: F on a line that also switches to G20 is NOT converted to mm', () => {
  const r = run('G21\nG20 G1 X1 F10\n');
  assert.equal(r.segs[0].feedRate, 10); // intended 254 mm/min
  assert.ok(close(r.segs[0].to.x, 25.4)); // the axis word IS converted
});

test('N3: repeated words: F takes the FIRST value, axes take the LAST', () => {
  const r = run('G21 G90\nG1 X5 X10 F100 F600\n');
  assert.equal(r.segs[0].feedRate, 100);
  assert.equal(r.segs[0].to.x, 10);
});

test('N4: CR-only line endings make the whole file one line', () => {
  const r = run('G21 G90\rG1 X10 F100\rG1 Y10\r');
  assert.equal(r.segs.length, 1); // one diagonal move, not two
  assert.deepEqual([r.segs[0].to.x, r.segs[0].to.y], [10, 10]);
});

test('N5: G53 reports an error, then moves in WORK coordinates anyway', () => {
  const r = run('G21 G90\nG10 L2 P1 X50\nG54\nG53 G0 X0\n');
  assert.match(r.errors[0].message, /G53/);
  assert.equal(r.segs[0].to.x, 50); // machine X0 intended
});

test('N6: G28 reports an error, then runs as an ordinary move', () => {
  const r = run('G21 G90\nG0 X10 Z10\nG28 Z0\n');
  assert.match(r.errors[0].message, /G28/);
  assert.equal(r.segs.at(-1).to.z, 0);
});

test('N7: arcs under 3.6° add no time or bounding box, and can make the estimate DECREASE', () => {
  // A 3.6° boundary: steps = round(|sweep| / 2π × 50), zero below 3.6°.
  const base = 'G21 G90\nG1 X100 F600\n';
  const line = run(base);
  const tiny = run(base + 'G2 X110 Y-0.05 R1000\n'); // 10 mm, 0.57° sweep
  const under = run(base + 'G2 X105.234 Y-0.137 R100\n'); // 3.0° sweep, R100
  const over = run(base + 'G2 X106.976 Y-0.244 R100\n'); // 4.0° sweep, R100: control
  // Mechanism: the line no longer decelerates to zero at X100. Its deceleration
  // moves into the arc, whose time is never sampled, so the total goes DOWN.
  assert.ok(tiny.time < line.time, `0.57° arc must reduce time: ${tiny.time} vs ${line.time}`);
  assert.ok(under.time < line.time, `3.0° arc must reduce time: ${under.time} vs ${line.time}`);
  assert.ok(
    over.time > line.time,
    `4.0° arc (control) must add time: ${over.time} vs ${line.time}`,
  );
  assert.equal(tiny.max.x, 100); // the arc's end (x=110) is missing from the bbox
});

test('N8: G4 dwell adds no time', () => {
  const a = run('G21 G90\nG1 X10 F600\n');
  const b = run('G21 G90\nG1 X10 F600\nG4 P10\n');
  assert.equal(a.time, b.time);
});

test('N9: rapids run at the 3000 mm/min default cap, not machine rapid rate', () => {
  const r = run('G21 G90\nG0 X3000\n');
  assert.equal(r.segs[0].feedRate, 3000);
});

test('N10: with no F word, feed defaults to 200 mm/min silently', () => {
  const r = run('G21 G90\nG1 X200\n');
  assert.equal(r.segs[0].feedRate, 200);
  assert.equal(r.errors.length, 0);
});

test('N11: every stop between segment groups adds a fixed 10 ms', () => {
  // Two straight segments: identical except for a 90° corner that forces a stop.
  const straight = run('G21 G90\nG1 X100 F600\nG1 X200\n');
  const corner = run('G21 G90\nG1 X100 F600\nG1 X100 Y100\n');
  // Upstream constants: acceleration 200 mm/s², feed 600 mm/min = 10 mm/s, so a
  // ramp takes v/a = 0.05 s over v²/2a = 0.25 mm.
  // straight (one group):  0.05 + 199.5/10 + 0.05 + 0.010 = 20.06 s
  // corner (two groups):   2 × (0.05 + 99.5/10 + 0.05) + 2 × 0.010 = 20.12 s
  assert.ok(close(straight.time, 20.06, 1e-6), `straight: ${straight.time}`);
  assert.ok(close(corner.time, 20.12, 1e-6), `corner: ${corner.time}`);
});

test('N12: M, S and T words are parsed and silently ignored', () => {
  const r = run('G21 G90\nM3 S24000\nT2 M6\nG1 X10 F100\nM5\n');
  assert.equal(r.errors.length, 0);
  assert.equal(r.segs.length, 1);
});
