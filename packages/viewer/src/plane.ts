// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { LoadedProgram } from './program.js';

/**
 * The maths of the 2D plan view (parcel 3d, ADR-0029), kept pure so it's testable
 * without a canvas. World: machine X/Y in mm, Y up. Screen: CSS pixels, Y down.
 * screen.x = (x - cx) * scale + width / 2, screen.y = height / 2 - (y - cy) * scale.
 */
export interface Transform {
  /** Pixels per mm. */
  readonly scale: number;
  /** The world point at the centre of the view. */
  readonly cx: number;
  readonly cy: number;
}

export const MIN_SCALE = 1e-4; // 10 km across a 1000 px view
export const MAX_SCALE = 1e4; // 0.1 mm across a 1000 px view

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function toScreen(
  t: Transform,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number] {
  return [(x - t.cx) * t.scale + w / 2, h / 2 - (y - t.cy) * t.scale];
}

export function toWorld(
  t: Transform,
  w: number,
  h: number,
  sx: number,
  sy: number,
): [number, number] {
  return [(sx - w / 2) / t.scale + t.cx, (h / 2 - sy) / t.scale + t.cy];
}

/** The transform that fits the program's XY box in a w × h view, with a margin. */
export function fitTransform(p: LoadedProgram | null, w: number, h: number): Transform {
  const b = p?.bounds.all;
  if (!b) return { scale: 1, cx: 0, cy: 0 };
  const dx = Math.max(b.max.X - b.min.X, 1e-3);
  const dy = Math.max(b.max.Y - b.min.Y, 1e-3);
  const scale = clampScale(Math.min(w / dx, h / dy) * 0.9);
  return { scale, cx: (b.min.X + b.max.X) / 2, cy: (b.min.Y + b.max.Y) / 2 };
}

/** Zooms by `factor` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(
  t: Transform,
  w: number,
  h: number,
  sx: number,
  sy: number,
  factor: number,
): Transform {
  const [wx, wy] = toWorld(t, w, h, sx, sy);
  const scale = clampScale(t.scale * factor);
  // Solve for the centre that keeps (wx, wy) at (sx, sy) under the new scale.
  return { scale, cx: wx - (sx - w / 2) / scale, cy: wy - (h / 2 - sy) / scale };
}

/** Pans by a screen-space drag of (dx, dy) pixels. */
export function panBy(t: Transform, dx: number, dy: number): Transform {
  return { scale: t.scale, cx: t.cx - dx / t.scale, cy: t.cy + dy / t.scale };
}

/**
 * Grid spacing in mm: 1, 2 or 5 × 10ⁿ, the smallest giving cells at least
 * `minPixels` wide at this scale. The grid adapts as you zoom.
 */
export function gridSpacing(scale: number, minPixels = 40): number {
  const raw = minPixels / scale;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * p;
}

/**
 * The segment nearest world point (x, y) in plan (XY), within `radius` mm, or -1.
 * Segment i joins vertex i to vertex i + 1. A linear scan: 226k segments take a few
 * milliseconds, and it only runs on a click.
 */
export function nearestSegment(p: LoadedProgram, x: number, y: number, radius: number): number {
  const pos = p.positions;
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i + 1 < p.count; i++) {
    const ax = pos[i * 3] as number;
    const ay = pos[i * 3 + 1] as number;
    const bx = pos[i * 3 + 3] as number;
    const by = pos[i * 3 + 4] as number;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * vx - x;
    const ey = ay + t * vy - y;
    const d = ex * ex + ey * ey;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Grid line positions (mm) covering [lo, hi] at `spacing`, capped for safety. */
export function gridLines(lo: number, hi: number, spacing: number, max = 400): number[] {
  const first = Math.ceil(lo / spacing);
  const last = Math.floor(hi / spacing);
  const out: number[] = [];
  for (let k = first; k <= last && out.length < max; k++) out.push(k * spacing);
  return out;
}
