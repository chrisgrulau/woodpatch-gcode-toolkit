// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * The motions of the drilling canned cycles G73, G81, G82 and G83 in the XY plane
 * (parcel 2c-2, ADR-0020), as a pure function so they can be checked against the
 * reference line by line. It follows LinuxCNC's interpreter source
 * (`src/emc/rs274ngc/interp_cycles.cc`: `convert_cycle_xy`, `CYCLE_MACRO`,
 * `convert_cycle_g81/g82/g83/g73`), not its prose docs, which differ in places (the
 * docs say G73 ends at R; the source retracts to the clearance plane).
 *
 * All values are machine coordinates in millimetres. The interpreter resolves G90/G91,
 * units, offsets, sticky R/Q/P/Z, repeats and errors before calling this.
 */

export type CycleCode = 'G73' | 'G81' | 'G82' | 'G83';

export interface CycleInput {
  readonly code: CycleCode;
  /** Current tool position when this block starts. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Hole positions, one per repeat, in order. */
  readonly holes: readonly { readonly x: number; readonly y: number }[];
  /** Retract (R) plane. */
  readonly r: number;
  /** Hole bottom (Z). Always below R: the interpreter rejects R < Z. */
  readonly bottom: number;
  /** The clearance plane: R under G99, the cycle's initial level under G98. */
  readonly clear: number;
  /** Peck depth (Q), for G73/G83; positive. */
  readonly peck?: number;
  /** Dwell at the bottom, in seconds, for G82. */
  readonly dwellSeconds?: number;
  /** G73 back-off after each peck. LinuxCNC: 0.254 mm (0.010 in); Masso: 1.0 mm. */
  readonly g73Retract: number;
  /** G83: how far above the last peck the rapid descent stops. LinuxCNC: 0.254 mm. */
  readonly g83Clearance: number;
}

export type CycleOp =
  | { readonly kind: 'rapid' | 'feed'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'dwell'; readonly seconds: number };

/** The ordered moves of one canned-cycle block (all its repeats). */
export function cycleOps(c: CycleInput): CycleOp[] {
  const ops: CycleOp[] = [];
  let x = c.x;
  let y = c.y;
  let z = c.z;
  const rapid = (nx: number, ny: number, nz: number) => {
    ops.push({ kind: 'rapid', x: nx, y: ny, z: nz });
    x = nx;
    y = ny;
    z = nz;
  };
  const feed = (nz: number) => {
    ops.push({ kind: 'feed', x, y, z: nz });
    z = nz;
  };

  c.holes.forEach((hole, i) => {
    // CYCLE_MACRO: on the first repeat, if above R, traverse XY at the current height
    // and then down to R. Otherwise traverse at the clearance plane, then down to R.
    if (i === 0 && z > c.r) {
      rapid(hole.x, hole.y, z);
      rapid(hole.x, hole.y, c.r);
    } else {
      rapid(hole.x, hole.y, c.clear);
      if (c.clear > c.r) rapid(hole.x, hole.y, c.r);
    }

    switch (c.code) {
      case 'G81':
        feed(c.bottom);
        break;
      case 'G82':
        feed(c.bottom);
        ops.push({ kind: 'dwell', seconds: c.dwellSeconds ?? 0 });
        break;
      case 'G83': {
        // for (depth = r - delta; depth > bottom; depth -= delta):
        //   feed to depth; rapid to r; rapid to depth + clearance
        const q = c.peck ?? 0;
        // Bounded by the peck count as well as the depth: the interpreter has already
        // refused a count over its limit, and this guarantees termination regardless.
        const max = Math.ceil((c.r - c.bottom) / q);
        for (let d = c.r - q, k = 0; d > c.bottom && k < max; d -= q, k++) {
          feed(d);
          rapid(x, y, c.r);
          rapid(x, y, d + c.g83Clearance);
        }
        feed(c.bottom);
        break;
      }
      case 'G73': {
        // for (depth = r - delta; depth > bottom; depth -= delta):
        //   feed to depth; rapid up by the retract
        const q = c.peck ?? 0;
        const max = Math.ceil((c.r - c.bottom) / q);
        for (let d = c.r - q, k = 0; d > c.bottom && k < max; d -= q, k++) {
          feed(d);
          rapid(x, y, d + c.g73Retract);
        }
        feed(c.bottom);
        break;
      }
    }
    // Every cycle ends with a rapid to the clearance plane.
    rapid(x, y, c.clear);
  });
  return ops;
}
