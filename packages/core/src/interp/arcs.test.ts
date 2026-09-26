// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  LINUXCNC_ARC_TOLERANCE,
  LINUXCNC_INTERPRETER_RULES,
  findTurn,
  interpret,
  motionSweep,
  pathBounds,
  parse,
  type InterpretOptions,
  type Step,
} from '../index.js';

// Parcel 2d (ADR-0022): arcs resolved and validated as LinuxCNC's interp_arc.cc does.

const run = (src: string, options?: InterpretOptions) => interpret(parse(src), options);
const arcs = (src: string, options?: InterpretOptions) =>
  run(src, options).steps.flatMap((s) => (s.kind === 'arc' ? [s] : []));
const moves = (steps: readonly Step[]) =>
  steps.flatMap((s) => (s.kind === 'linear' || s.kind === 'arc' ? [s] : []));
const errors = (src: string, options?: InterpretOptions) =>
  run(src, options)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.code);
const PI = Math.PI;

describe('findTurn (LinuxCNC find_turn)', () => {
  it('turns the short or long way by direction', () => {
    // From (1,0) to (0,1) about the origin.
    expect(findTurn(1, 0, 0, 0, false, 1, 0, 1)).toBeCloseTo(PI / 2, 12);
    expect(findTurn(1, 0, 0, 0, true, 1, 0, 1)).toBeCloseTo((-3 * PI) / 2, 12);
  });
  it('makes a full circle when the end is the start, and adds whole turns for P', () => {
    expect(findTurn(1, 0, 0, 0, false, 1, 1, 0)).toBeCloseTo(2 * PI, 12);
    expect(findTurn(1, 0, 0, 0, true, 1, 1, 0)).toBeCloseTo(-2 * PI, 12);
    expect(findTurn(1, 0, 0, 0, false, 3, 0, 1)).toBeCloseTo(PI / 2 + 4 * PI, 12);
    expect(findTurn(1, 0, 0, 0, true, 2, 1, 0)).toBeCloseTo(-4 * PI, 12);
  });
});

describe('the plan’s reproductions', () => {
  it('R2: refuses an R arc that cannot reach its end point, and leaves the tool put', () => {
    // Plan §2.2: upstream drew 10→40 straight with no error.
    const r = run('G21 G90 G1 X10 F100\nG2 X30 Y0 R5\nG1 X40');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_ARC_R_TOO_SMALL']);
    expect(moves(r.steps).map((s) => [s.kind, s.from.X, s.to.X])).toEqual([
      ['linear', 0, 10],
      ['linear', 10, 40],
    ]);
  });

  it('R3: draws an arc with no axis words as a full circle', () => {
    // Plan §2.2: upstream dropped G2 I-5 silently.
    const [a] = arcs('G21 G90 G1 X10 F100\nG2 I-5\nG1 X40');
    expect(a).toMatchObject({ radius: 5, endRadius: 5, centre: { X: 5, Y: 0 } });
    expect(a?.sweep).toBeCloseTo(-2 * PI, 12);
  });
});

describe('radius format (R)', () => {
  it('accepts a semicircle whose chord is a hair over 2R (LinuxCNC radius tolerance)', () => {
    const [a] = arcs('G21 G90 F100\nG2 X20.001 R10');
    expect(a?.sweep).toBeCloseTo(-PI, 12);
    expect(errors('G21 G90 F100\nG2 X20.01 R10')).toEqual(['SEMANTIC_ARC_R_TOO_SMALL']);
  });

  it('refuses an R arc that ends where it starts, and one with no in-plane axis', () => {
    expect(errors('G21 G90 F100\nG0 X10\nG2 X10 Y0 R5')).toEqual(['SEMANTIC_ARC_R_SAME_POINT']);
    expect(errors('G21 G90 F100\nG2 Z-1 R5')).toEqual(['SEMANTIC_ARC_R_FULL_CIRCLE']);
  });
});

describe('centre format: radius mismatch (LinuxCNC arc_data_ijk)', () => {
  // From X10 about the origin to (-10 - e, 0): the end radius is 10 + e.
  const mismatch = (e: number, options?: InterpretOptions) =>
    run(`G21 G90 F100\nG0 X10\nG2 X${-10 - e} Y0 I-10 J0`, options);

  it('accepts a mismatch within tolerance as a spiral', () => {
    const r = mismatch(0.02);
    expect(r.diagnostics).toEqual([]);
    const [a] = arcs(`G21 G90 F100\nG0 X10\nG2 X-10.02 Y0 I-10 J0`);
    expect(a).toMatchObject({ radius: 10 });
    expect(a?.endRadius).toBeCloseTo(10.02, 12);
  });

  it('refuses a mismatch beyond it, as LinuxCNC would (Masso accepted 0.5 mm: dialect data)', () => {
    expect(mismatch(0.5).diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_ARC_RADIUS_MISMATCH']);
    const lenient = {
      interpreterRules: {
        ...LINUXCNC_INTERPRETER_RULES,
        arcTolerance: { ...LINUXCNC_ARC_TOLERANCE, spiralMm: 1 },
      },
    };
    expect(mismatch(0.5, lenient).diagnostics).toEqual([]);
  });

  it('needs both the absolute and the relative test to fail, below 100x', () => {
    // Radius 1: 0.02 mm is 2% but under 0.028 mm, so it passes; 0.03 mm fails.
    expect(errors('G21 G90 F100\nG0 X1\nG2 X-1.02 Y0 I-1')).toEqual([]);
    expect(errors('G21 G90 F100\nG0 X1\nG2 X-1.03 Y0 I-1')).toEqual([
      'SEMANTIC_ARC_RADIUS_MISMATCH',
    ]);
    // Radius 1000: 0.5 mm is 0.05%, under the relative limit, so it passes; but more
    // than 100x the absolute tolerance (2.83 mm) always fails.
    expect(errors('G21 G90 F100\nG0 X1000\nG2 X-1000.5 Y0 I-1000')).toEqual([]);
    expect(errors('G21 G90 F100\nG0 X1000\nG2 X-1003 Y0 I-1000')).toEqual([
      'SEMANTIC_ARC_RADIUS_MISMATCH',
    ]);
  });

  it('uses the inch tolerances in an inch program', () => {
    // 0.002 in is under 0.00283 in; 0.004 in on a 1 in radius fails both tests.
    expect(errors('G20 G90 F10\nG0 X1\nG2 X-1.002 Y0 I-1')).toEqual([]);
    expect(errors('G20 G90 F10\nG0 X1\nG2 X-1.004 Y0 I-1')).toEqual([
      'SEMANTIC_ARC_RADIUS_MISMATCH',
    ]);
  });

  it('refuses a zero-radius arc', () => {
    expect(errors('G21 G90 F100\nG0 X10\nG2 X0 I0 J0')).toEqual(['SEMANTIC_ARC_ZERO_RADIUS']);
  });
});

describe('planes, turns and helices', () => {
  it('turns from the plane’s first axis to its second (G18: Z to X)', () => {
    // G18 G3 from X10 about the origin to Z10: in (Z, X) that's (0,10) → (10,0),
    // counter-clockwise from 90° to 0°: three quarters of a turn.
    const [a] = arcs('G21 G90 G18 F100\nG0 X10\nG3 X0 Z10 I-10 K0');
    expect(a).toMatchObject({ plane: 'ZX', radius: 10, centre: { X: 0, Z: 0 } });
    expect(a?.sweep).toBeCloseTo((3 * PI) / 2, 12);
  });

  it('adds whole turns for P', () => {
    const [a] = arcs('G21 G90 F100\nG0 X10\nG2 X0 Y10 I-10 P2');
    expect(a?.sweep).toBeCloseTo((-3 * PI) / 2 - 2 * PI, 12);
    expect(a?.turns).toBe(2);
  });

  it('keeps the normal axis moving evenly for a helix', () => {
    const [a] = arcs('G21 G90 F100\nG0 X10\nG2 I-10 Z-5');
    expect(a).toMatchObject({ from: { Z: 0 }, to: { X: 10, Y: 0, Z: -5 } });
    expect(a?.sweep).toBeCloseTo(-2 * PI, 12);
  });
});

describe('review findings on #14, pinned (LinuxCNC 2.9 source)', () => {
  it('cuts a FULL circle when the end is within CART_FUZZ of the start, G2 and G3 alike', () => {
    // Incremental moves that return to the start with rounding noise, then an arc back
    // to it: the machine cuts a full circle (pmCircleInit), out to X2.3.
    for (const dir of ['G2', 'G3']) {
      const src = `G21 G90 G17 F100\nG0 X0 Y0\nG91 G1 X0.1 Y0.1\nX0.1 Y0.1\nX0.1 Y0.1\nG90 ${dir} X0.3 Y0.3 I1 J0`;
      const [a] = arcs(src);
      expect(Math.abs(a?.sweep ?? 0), dir).toBeCloseTo(2 * PI, 9);
      expect(pathBounds(run(src).steps).feed?.max.X, dir).toBeCloseTo(2.3, 6);
    }
    expect(motionSweep(1, 0, 0, 0, false, 1, 1 + 5e-9, 0)).toBeCloseTo(2 * PI, 12);
    expect(motionSweep(1, 0, 0, 0, true, 1, 1 + 5e-9, 0)).toBeCloseTo(-2 * PI, 12);
    // The planar rule on its own: at r=10 an end 5e-9 AHEAD in the arc's direction has
    // a cross product of about 5e-8 (over CART_FUZZ), so only the endpoint distance
    // (under 1e-8) makes it a full circle.
    expect(motionSweep(10, 0, 0, 0, false, 1, 10, 5e-9)).toBeCloseTo(2 * PI, 12);
    expect(motionSweep(10, 0, 0, 0, true, 1, 10, -5e-9)).toBeCloseTo(-2 * PI, 12);
    // Further ahead than the fuzz, it's the tiny arc it looks like.
    expect(motionSweep(10, 0, 0, 0, false, 1, 10, 1e-6)).toBeCloseTo(1e-7, 12);
  });

  it('agrees with find_turn away from the fuzz', () => {
    for (const [a2, b2] of [
      [0, 1],
      [-1, 0],
      [0, -1],
      [0.6, 0.8],
    ] as const)
      for (const cw of [false, true])
        for (const turns of [1, 2])
          expect(motionSweep(1, 0, 0, 0, cw, turns, a2, b2)).toBeCloseTo(
            findTurn(1, 0, 0, 0, cw, turns, a2, b2),
            12,
          );
  });

  it('refuses non-finite values, fail-closed (G20 overflow)', () => {
    // A value that fits a double but overflows x25.4 (G-code has no exponent notation).
    const huge = '9' + '0'.repeat(307);
    expect(errors(`G20 F10\nG2 X1 I${huge}`)).toEqual(['SEMANTIC_ARC_NOT_FINITE']);
    expect(errors(`G20 F10\nG1 X${huge}`)).toEqual(['SEMANTIC_NOT_FINITE']);
  });

  it('refuses R0 with a tiny chord (no silent NaN arc)', () => {
    expect(errors('G21 F100\nG2 X0.000001 R0')).toEqual(['SEMANTIC_ARC_ZERO_RADIUS']);
  });

  it('applies 2.9\u2019s arc word checks', () => {
    // G90.1: both centre words required.
    expect(errors('G21 F100 G90.1\nG0 X10\nG2 X0 Y0 I5')).toEqual(['SEMANTIC_ARC_CENTRE_MISSING']);
    // G91.1: a missing one is 0.
    expect(errors('G21 F100\nG0 X10\nG2 X0 Y0 I-5')).toEqual([]);
    // K in the XY plane is refused.
    expect(errors('G21 F100\nG0 X10\nG2 X0 K1 I-5')).toContain('SEMANTIC_OFFSET_NOT_IN_PLANE');
    // A bare G2 is refused.
    expect(errors('G21 F100\nG2')).toEqual(['SEMANTIC_ARC_NO_CENTRE']);
    // P within 0.001 of a whole number is accepted and rounded.
    expect(arcs('G21 F100\nG0 X10\nG2 I-10 P2.0005')[0]?.turns).toBe(2);
    expect(errors('G21 F100\nG0 X10\nG2 I-10 P2.01')).toEqual(['SEMANTIC_ARC_TURNS']);
  });

  it('kills the three surviving mutants', () => {
    // 100x rule alone: r=5000 with a 3 mm mismatch passes the relative test (0.06%).
    expect(errors('G21 F100\nG0 X5000\nG2 X-5003 Y0 I-5000')).toEqual([
      'SEMANTIC_ARC_RADIUS_MISMATCH',
    ]);
    // Zero END radius alone.
    expect(errors('G21 F100\nG0 X0.02\nG2 X0 Y0 I-0.02')).toEqual(['SEMANTIC_ARC_ZERO_RADIUS']);
  });

  it('turns from Y to Z in G19, and uses inch tolerances for inch R arcs', () => {
    const [a] = arcs('G21 G19 F100\nG0 Y10\nG3 Y0 Z10 J-10 K0');
    expect(a?.sweep).toBeCloseTo(PI / 2, 12);
    // 0.00005 in allowance: a chord 0.00004 in over 2R passes, 0.0001 in fails.
    expect(errors('G20 F10\nG2 X2.00004 R1')).toEqual([]);
    expect(errors('G20 F10\nG2 X2.0001 R1')).toEqual(['SEMANTIC_ARC_R_TOO_SMALL']);
  });
});
