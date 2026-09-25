// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from './index.js';

describe('ATTRIBUTION', () => {
  it('credits the upstream author and links to upstream', () => {
    expect(ATTRIBUTION.credit).toContain('Nicolas Raynaud');
    expect(ATTRIBUTION.upstream.url).toBe('https://github.com/nraynaud/webgcode');
  });

  it("records the MIT election and upstream's dual offer", () => {
    expect(ATTRIBUTION.licence).toBe('MIT');
    expect(ATTRIBUTION.upstream.licence).toBe('MIT OR AGPL-3.0');
  });

  it('cannot be mutated by a consumer', () => {
    expect(Object.isFrozen(ATTRIBUTION)).toBe(true);
    expect(Object.isFrozen(ATTRIBUTION.upstream)).toBe(true);
  });
});
