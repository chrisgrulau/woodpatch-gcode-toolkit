// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * Arc resolution and validation (parcel 2d, ADR-0022), transcribed from LinuxCNC's
 * interpreter: `arc_data_ijk`, `arc_data_r` (interp_arc.cc) and `find_turn`
 * (interp_find.cc). Pure functions on the two in-plane coordinates, so each rule can
 * be checked against the source directly.
 *
 * "a" and "b" are the plane's first and second axes in LinuxCNC's order: XY for G17,
 * ZX for G18, YZ for G19. A positive sweep turns from a towards b (counter-clockwise
 * seen from the positive normal axis).
 */

/** How far an arc's geometry may be off before it's an error. Per controller. */
export interface ArcTolerance {
  /**
   * Centre format: how much the radius to the end may differ from the radius to the
   * start (LinuxCNC `center_arc_radius_tolerance`, in program units). Always an error
   * above 100x this; above 1x it's an error only if the relative difference exceeds
   * `spiralRelative` too.
   */
  readonly spiralMm: number;
  readonly spiralInch: number;
  /** LinuxCNC SPIRAL_RELATIVE_TOLERANCE. */
  readonly spiralRelative: number;
  /**
   * The minimum radius, and how far short an R-format radius may fall of reaching
   * the end point (LinuxCNC RADIUS_TOLERANCE_*).
   */
  readonly radiusMm: number;
  readonly radiusInch: number;
}

/** LinuxCNC's defaults (interp_internal.hh). */
export const LINUXCNC_ARC_TOLERANCE: ArcTolerance = Object.freeze({
  spiralMm: 2 * 0.01 * Math.SQRT2,
  spiralInch: 2 * 0.001 * Math.SQRT2,
  spiralRelative: 0.001,
  radiusMm: 0.00005 * 25.4,
  radiusInch: 0.00005,
});

export interface ArcGeometry {
  /** Centre, in the plane's two axes. */
  readonly ca: number;
  readonly cb: number;
  /** Radius at the start. */
  readonly radius: number;
  /** Radius at the end: differs from `radius` for a (tolerated) spiral. */
  readonly endRadius: number;
  /** Signed sweep in radians, positive counter-clockwise; includes full turns. */
  readonly sweep: number;
}

export type ArcResult =
  | { readonly ok: true; readonly arc: ArcGeometry }
  | { readonly ok: false; readonly code: string; readonly message: string };

const TAU = 2 * Math.PI;
/** LinuxCNC TINY, for the semicircle allowance in arc_data_r. */
const TINY = 1e-12;

/**
 * The signed angle from start to end around the centre, for `turns` turns in the
 * given direction (LinuxCNC find_turn). With start and end at the same angle, a turn
 * is a full circle.
 */
export function findTurn(
  a1: number,
  b1: number,
  ca: number,
  cb: number,
  clockwise: boolean,
  turns: number,
  a2: number,
  b2: number,
): number {
  let alpha = Math.atan2(b1 - cb, a1 - ca);
  let beta = Math.atan2(b2 - cb, a2 - ca);
  if (!clockwise) {
    if (beta <= alpha) beta += TAU;
    return beta - alpha + (turns - 1) * TAU;
  }
  if (alpha <= beta) alpha += TAU;
  return beta - alpha - (turns - 1) * TAU;
}

/**
 * Tolerances are in program units in LinuxCNC; these values are in mm. `scale` is
 * 25.4 for an inch program and 1 for mm, so the inch tolerances apply to inch programs.
 */
function tolerances(t: ArcTolerance, inch: boolean) {
  return inch
    ? { spiral: t.spiralInch * 25.4, radius: t.radiusInch * 25.4 }
    : { spiral: t.spiralMm, radius: t.radiusMm };
}

/** Centre format (I/J/K), with the centre already resolved (LinuxCNC arc_data_ijk). */
export function arcFromCentre(
  a1: number,
  b1: number,
  a2: number,
  b2: number,
  ca: number,
  cb: number,
  clockwise: boolean,
  turns: number,
  tol: ArcTolerance,
  inch: boolean,
): ArcResult {
  const t = tolerances(tol, inch);
  const radius = Math.hypot(ca - a1, cb - b1);
  const endRadius = Math.hypot(ca - a2, cb - b2);
  if (radius < t.radius || endRadius < t.radius) {
    return {
      ok: false,
      code: 'SEMANTIC_ARC_ZERO_RADIUS',
      message: 'Zero-radius arc: the centre is on the start or end point; line not run',
    };
  }
  const absErr = Math.abs(radius - endRadius);
  const relErr = absErr / Math.max(radius, endRadius);
  if (absErr > t.spiral * 100 || (relErr > tol.spiralRelative && absErr > t.spiral)) {
    const f = (v: number) => (inch ? v / 25.4 : v).toFixed(4);
    return {
      ok: false,
      code: 'SEMANTIC_ARC_RADIUS_MISMATCH',
      message: `Radius to the end of the arc (${f(endRadius)}) differs from the radius to the start (${f(radius)}) by more than this controller allows; line not run`,
    };
  }
  return {
    ok: true,
    arc: { ca, cb, radius, endRadius, sweep: findTurn(a1, b1, ca, cb, clockwise, turns, a2, b2) },
  };
}

/**
 * Radius format (R), LinuxCNC arc_data_r: the centre is on the perpendicular bisector
 * of the chord. A negative R takes the arc larger than a semicircle.
 */
export function arcFromRadius(
  a1: number,
  b1: number,
  a2: number,
  b2: number,
  r: number,
  clockwise: boolean,
  turns: number,
  tol: ArcTolerance,
  inch: boolean,
): ArcResult {
  const t = tolerances(tol, inch);
  if (a1 === a2 && b1 === b2) {
    return {
      ok: false,
      code: 'SEMANTIC_ARC_R_SAME_POINT',
      message:
        'A radius-format arc cannot end where it starts (the centre is undefined); line not run',
    };
  }
  const absR = Math.abs(r);
  const midA = (a1 + a2) / 2;
  const midB = (b1 + b2) / 2;
  let half = Math.hypot(midA - a2, midB - b2);
  if (half - absR > t.radius) {
    // R2: upstream computed a NaN centre and drew nothing, silently.
    return {
      ok: false,
      code: 'SEMANTIC_ARC_R_TOO_SMALL',
      message: `Arc radius ${(inch ? absR / 25.4 : absR).toFixed(4)} is too small to reach the end point; line not run`,
    };
  }
  if (half / absR > 1 - TINY) half = absR; // allow a small error for a semicircle
  const toward = Math.atan2(b2 - b1, a2 - a1);
  const theta =
    (clockwise && r > 0) || (!clockwise && r < 0) ? toward - Math.PI / 2 : toward + Math.PI / 2;
  const offset = absR * Math.cos(Math.asin(half / absR));
  const ca = midA + offset * Math.cos(theta);
  const cb = midB + offset * Math.sin(theta);
  const radius = Math.hypot(ca - a1, cb - b1);
  return {
    ok: true,
    arc: {
      ca,
      cb,
      radius,
      endRadius: Math.hypot(ca - a2, cb - b2),
      sweep: findTurn(a1, b1, ca, cb, clockwise, turns, a2, b2),
    },
  };
}
