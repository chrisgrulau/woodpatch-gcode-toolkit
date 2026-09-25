// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { interpret, parse, type InterpretOptions, type Step } from '../index.js';

const run = (src: string, options?: InterpretOptions) => interpret(parse(src), options);
const moves = (steps: readonly Step[]) =>
  steps.flatMap((s) => (s.kind === 'linear' || s.kind === 'arc' ? [s] : []));
const ends = (src: string, options?: InterpretOptions) =>
  moves(run(src, options).steps).map((s) => [s.to.X, s.to.Y, s.to.Z]);
const codes = (src: string, options?: InterpretOptions) =>
  run(src, options).diagnostics.map((d) => d.code);

describe('motion basics', () => {
  it('produces rapid and feed moves in machine coordinates', () => {
    const r = run('G21 G90\nG0 X10 Y5\nG1 Z-1 F600\nX20');
    const m = moves(r.steps);
    expect(m.map((s) => s.kind === 'linear' && s.rapid)).toEqual([true, false, false]);
    expect(m.map((s) => [s.to.X, s.to.Y, s.to.Z])).toEqual([
      [10, 5, 0],
      [10, 5, -1],
      [20, 5, -1],
    ]);
    expect(m[1]).toMatchObject({ feed: { mode: 'per-minute', mmPerMinute: 600 } });
    expect(r.diagnostics).toEqual([]);
  });

  it('keeps every move, even a tiny or zero-length one (fixes R9)', () => {
    expect(ends('G21 G90 G1 F100\nX0.005\nX0.010\nX0.010')).toEqual([
      [0.005, 0, 0],
      [0.01, 0, 0],
      [0.01, 0, 0],
    ]);
  });

  it('converts inches to millimetres', () => {
    expect(ends('G20 G90\nG0 X1 Y0.5')).toEqual([[25.4, 12.7, 0]]);
  });

  it('moves incrementally in G91', () => {
    expect(ends('G21 G91\nG0 X10\nX10\nY-5')).toEqual([
      [10, 0, 0],
      [20, 0, 0],
      [20, -5, 0],
    ]);
  });

  it('refuses a feed move with no feed rate, and leaves the tool where it was (fixes N10)', () => {
    const r = run('G21 G90\nG1 X10\nG0 Y5');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_NO_FEED_RATE']);
    expect(moves(r.steps).map((s) => [s.to.X, s.to.Y])).toEqual([[0, 5]]);
  });
});

describe('order of execution (RS274/NGC, not line order)', () => {
  it('converts F with the units in force at the end of its line (fixes N2)', () => {
    const [m] = moves(run('G21\nG20 G1 X1 F10').steps);
    expect(m).toMatchObject({ feed: { mmPerMinute: 254 }, to: { X: 25.4 } });
  });

  it('applies plane, units and distance mode before the motion on the same line', () => {
    expect(ends('G21 G90\nG0 X10\nG1 F100 X5 G91')).toEqual([
      [10, 0, 0],
      [15, 0, 0],
    ]);
  });

  it("applies parameter assignments AFTER the line (LinuxCNC's own example)", () => {
    // "if parameter 3 has been previously set to 15 and the line #3=6 G1 X#3 is
    // interpreted, a straight move to a point where X equals 15 will occur"
    const r = run('G21 G90 F100\n#3=15\n#3=6 G1 X#3\nG1 X#3');
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([15, 6]);
  });
});

describe('work offsets, G53, G92, homes', () => {
  it('does not re-add a work offset on each incremental move (fixes R5)', () => {
    // The machine starts at machine X0. In G91, X1 means "1 mm from here", whatever the
    // offset, so the moves end at machine 1, 2, 3. Upstream re-added the offset each time
    // (101, 202, 303). Note: plan §2.2's "expected 101, 102, 103" assumed the tool starts
    // at work zero, which is not what this program says.
    expect(ends('G21\nG10 L2 P1 X100\nG54 G91 G1 F100\nX1\nX1\nX1').map((p) => p[0])).toEqual([
      1, 2, 3,
    ]);
    // From work zero (machine 100), the plan's numbers do come out:
    expect(
      ends('G21\nG10 L2 P1 X100\nG54 G90 G0 X0\nG91 G1 F100\nX1\nX1\nX1').map((p) => p[0]),
    ).toEqual([100, 101, 102, 103]);
  });

  it("switches coordinate systems and reports each move's offset", () => {
    const r = run('G21 G90\nG10 L2 P2 X50 Y10\nG55 G0 X0 Y0\nG54 G0 X0 Y0');
    const m = moves(r.steps);
    expect(m.map((s) => [s.to.X, s.to.Y])).toEqual([
      [50, 10],
      [0, 0],
    ]);
    expect(m[0]!.offset).toMatchObject({ X: 50, Y: 10 });
  });

  it('G10 L20 sets the offset that makes the current position read the given value', () => {
    const r = run('G21 G90\nG0 X30\nG10 L20 P1 X0\nG0 X5');
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([30, 35]);
  });

  it('G53 moves in MACHINE coordinates, ignoring offsets (fixes N5)', () => {
    const r = run('G21 G90\nG10 L2 P1 X50\nG54\nG53 G0 X0\nG0 X0');
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([0, 50]);
    expect(r.diagnostics).toEqual([]);
  });

  it('G92 offsets, and G92.1 cancels them', () => {
    const r = run('G21 G90\nG0 X10\nG92 X0\nG0 X5\nG92.1\nG0 X5');
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([10, 15, 5]);
  });

  it('G28 rapids via the intermediate point to the stored home, and says when home was never set (fixes N6)', () => {
    const r = run('G21 G90\nG0 X10 Z10\nG28 Z20');
    expect(moves(r.steps).map((s) => [s.to.X, s.to.Z])).toEqual([
      [10, 10],
      [10, 20], // intermediate point
      [10, 0], // stored home for Z only (unset: machine origin)
    ]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_HOME_UNSET_5161']);
  });

  it('G28.1 stores home, and G28 with no axis words returns every axis there', () => {
    const r = run('G21 G90\nG0 X5 Y6 Z7\nG28.1\nG0 X0 Y0 Z0\nG28');
    expect(moves(r.steps).at(-1)!.to).toMatchObject({ X: 5, Y: 6, Z: 7 });
    expect(r.diagnostics).toEqual([]);
  });

  it("exposes offsets through LinuxCNC's parameter numbers", () => {
    const r = run('G21 G90 F100\nG10 L2 P1 X12\n#100=#5221\nG1 X#100');
    // G54 X offset 12, and moving to work X12 is machine X24.
    expect(moves(r.steps)[0]!.to.X).toBe(24);
  });
});

describe('arcs (described here; resolved and validated by the geometry layer)', () => {
  it('turns I/J into an absolute centre, incremental by default', () => {
    const [a] = moves(run('G21 G90 F100\nG0 X10\nG2 X0 Y10 I-10 J0').steps).slice(1);
    expect(a).toMatchObject({
      kind: 'arc',
      clockwise: true,
      plane: 'XY',
      centre: { X: 0, Y: 0 },
      radius: null,
      turns: 1,
    });
  });

  it('reads absolute centres in G90.1', () => {
    const [, a] = moves(run('G21 G90 G90.1 F100\nG0 X10\nG3 X0 Y10 I3 J4').steps);
    expect(a).toMatchObject({ centre: { X: 3, Y: 4 }, clockwise: false });
  });

  it('keeps R arcs as a signed radius', () => {
    const [, a] = moves(run('G21 G90 F100\nG0 X0\nG2 X20 R-10').steps);
    expect(a).toMatchObject({ radius: -10, centre: null });
  });

  it('runs a centre-format full circle with no axis words (fixes R3)', () => {
    const [, a] = moves(run('G21 G90 F100\nG1 X10\nG2 I-5').steps);
    expect(a).toMatchObject({ kind: 'arc', from: { X: 10 }, to: { X: 10 }, centre: { X: 5 } });
  });

  it("uses the plane's own offset letters", () => {
    const [, a] = moves(run('G21 G90 G18 F100\nG1 X10\nG2 X0 Z10 I-10 K0').steps);
    expect(a).toMatchObject({ plane: 'ZX', centre: { X: 0, Z: 0 } });
  });

  it('reports arcs it cannot describe', () => {
    expect(codes('G21 G90 F100\nG2 X10 Y0')).toContain('SEMANTIC_ARC_NO_CENTRE');
    expect(codes('G21 G90 F100\nG2 X10 R5 I5')).toContain('SEMANTIC_ARC_R_AND_IJK');
    expect(codes('G21 G90 F100\nG2 R5')).toContain('SEMANTIC_ARC_R_FULL_CIRCLE');
  });

  it('takes P as full turns', () => {
    expect(moves(run('G21 G90 F100\nG2 X0 Y0 I5 P3').steps)[0]).toMatchObject({ turns: 3 });
  });
});

describe('lines that cannot run are reported, and the tool stays put', () => {
  it('rejects repeated words (fixes N3)', () => {
    const r = run('G21 G90 F100\nG1 X5 X10');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_REPEATED_WORD']);
    expect(moves(r.steps)).toEqual([]);
  });

  it('rejects unsupported codes, instead of moving anyway (fixes N5/N6 behaviour)', () => {
    const r = run('G21 G90\nG0 X10\nG12 X20');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_UNSUPPORTED_CODE']);
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([10]);
  });

  it('names the parcel for recognised codes that are not interpreted yet (canned cycles: R4)', () => {
    const r = run('G21 G90\nG0 Z5\nG81 X10 Y10 Z-5 R1 F100');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_NOT_YET_SUPPORTED']);
    expect(r.diagnostics[0]!.message).toContain('2c-2');
    expect(moves(r.steps)).toHaveLength(1); // no rapid plunge to depth, as upstream drew
  });

  it('rejects two codes from one modal group, and a group-0/motion clash', () => {
    expect(codes('G0 G1 X1')).toEqual(['SEMANTIC_MODAL_GROUP_CONFLICT']);
    expect(codes('G92 X0 G1 Y1 F100')).toEqual(['SEMANTIC_AXIS_WORDS_CONFLICT']);
  });

  it('rejects E, with a hint about exponents (fixes R6)', () => {
    const program = parse('G21 G90 F100\nG1 X1e3');
    expect(program.diagnostics.map((d) => d.code)).toEqual(['SYNTAX_POSSIBLE_EXPONENT']);
    const r = interpret(program); // syntax findings stay on the Program; these are the interpreter's own
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_UNSUPPORTED_WORD']);
    expect(moves(r.steps)).toEqual([]);
  });

  it('does not run a line with syntax errors or evaluation errors', () => {
    expect(codes('G1 X[1/0] F100')).toContain('SEMANTIC_LINE_NOT_RUN');
    expect(codes('G1 X[1+ F100')).toContain('SEMANTIC_LINE_NOT_RUN');
  });

  it('never throws on the whole corpus', () => {
    const dir = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
    for (const sub of ['synthetic', 'upstream']) {
      for (const f of readdirSync(join(dir, sub)).filter((x) => /\.(ngc|nc)$/.test(x))) {
        expect(() => run(readFileSync(join(dir, sub, f), 'utf8'))).not.toThrow();
      }
    }
  });
});

describe('events and program end', () => {
  it('emits spindle, coolant, tool change, dwell and pause steps', () => {
    const r = run('G21\nT2 M6\nS12000 M3\nM7 M8\nG4 P1.5\nM1\nM9 M5');
    expect(r.steps.map((s) => s.kind)).toEqual([
      'tool-change',
      'spindle',
      'coolant',
      'dwell',
      'pause',
      'spindle',
      'coolant',
    ]);
    expect(r.steps[0]).toMatchObject({ tool: 2 });
    expect(r.steps[1]).toMatchObject({ state: 'cw', rpm: 12000 });
    expect(r.steps[2]).toMatchObject({ mist: true, flood: true });
    expect(r.steps[3]).toMatchObject({ seconds: 1.5 });
    expect(r.diagnostics).toEqual([]);
  });

  it('stops at M2/M30 and reports what was not run (fixes R8)', () => {
    const r = run('G21 G90 F100\nG1 X10\nM30\nG1 X20\nG1 X30');
    expect(moves(r.steps).map((s) => s.to.X)).toEqual([10]);
    expect(r.steps.at(-1)).toMatchObject({ kind: 'end', by: 'M30' });
    expect(r.diagnostics).toMatchObject([{ code: 'SEMANTIC_AFTER_PROGRAM_END', line: 4 }]);
  });

  it('skips block-deleted lines when the switch is on (default), and runs them when off', () => {
    expect(ends('G21 G90 F100\n/G1 X20\nG1 X30').map((p) => p[0])).toEqual([30]);
    expect(ends('G21 G90 F100\n/G1 X20\nG1 X30', { blockDelete: false }).map((p) => p[0])).toEqual([
      20, 30,
    ]);
  });

  it('warns that cutter compensation is not simulated (ADR-0016)', () => {
    const r = run('G21 G90 F100\nG41 D1\nG1 X10\nG40');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['SEMANTIC_CUTTER_COMP_NOT_APPLIED']);
    expect(moves(r.steps)[0]!.to.X).toBe(10);
  });

  it('warns about words that have no effect', () => {
    expect(codes('G21 G90 F100\nG1 X1 R5')).toEqual(['SEMANTIC_UNUSED_WORD']);
  });

  it('needs F on every feed move in inverse-time mode', () => {
    expect(codes('G21 G90 G93\nG1 X1 F2\nG1 X2')).toEqual(['SEMANTIC_NO_FEED_RATE']);
  });
});
