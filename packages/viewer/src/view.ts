// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/** Standard views: unit directions FROM the target TO the camera (Z up). */
export const VIEW_DIRECTIONS = {
  iso: [0.5774, -0.5774, 0.5774],
  top: [0, -1e-6, 1],
  front: [0, -1, 0],
  right: [1, 0, 0],
} as const satisfies Record<string, readonly [number, number, number]>;

export type ViewName = keyof typeof VIEW_DIRECTIONS;

/**
 * Camera distance that fits a sphere of `radius` in view, for a vertical field of
 * view `fovDeg` and an aspect ratio (the narrower of the two angles decides), with a
 * little margin.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  const narrow = Math.min(v, h);
  return (radius / Math.sin(narrow / 2)) * 1.1;
}

/** A grid a round size (1, 2 or 5 × 10ⁿ mm per cell) covering `extent` mm, 10–20 cells. */
export function gridSpec(extent: number): { size: number; divisions: number } {
  const e = Math.max(extent, 1) * 1.2;
  const raw = e / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  const cell = [1, 2, 5, 10].map((m) => m * p).find((c) => c >= raw) ?? 10 * p;
  const divisions = Math.ceil(e / cell);
  return { size: divisions * cell, divisions };
}
