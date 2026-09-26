// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  LINUXCNC_ARC_TOLERANCE,
  LINUXCNC_INTERPRETER_RULES,
  findTurn,
  interpret,
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
