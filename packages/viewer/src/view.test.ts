// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { fitDistance, gridSpec, VIEW_DIRECTIONS } from './view.js';

describe('view helpers', () => {
  it('fits a sphere by the narrower field of view', () => {
    const wide = fitDistance(10, 45, 2);
    const tall = fitDistance(10, 45, 0.5);
    expect(tall).toBeGreaterThan(wide);
    // At the fitted distance the sphere subtends the narrow angle (with 10% margin).
    const v = (45 * Math.PI) / 180;
    expect((10 / Math.sin(v / 2)) * 1.1).toBeCloseTo(wide, 9);
  });

  it('picks round grid cells (1, 2, 5 × 10ⁿ) covering the path', () => {
    expect(gridSpec(100)).toEqual({ size: 120, divisions: 6 });
    expect(gridSpec(1600)).toEqual({ size: 2000, divisions: 10 });
    const g = gridSpec(37);
    expect(g.size).toBeGreaterThanOrEqual(37 * 1.2);
  });

  it('has unit view directions', () => {
    for (const d of Object.values(VIEW_DIRECTIONS)) expect(Math.hypot(...d)).toBeCloseTo(1, 3);
  });
});
