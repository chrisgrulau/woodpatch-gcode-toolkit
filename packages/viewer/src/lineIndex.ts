// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { LoadedProgram } from './program.js';

/**
 * Source line ↔ segments, for highlighting and picking (upstream's `lineSegmentMap`,
 * which plan §2.3 says to keep). A line can own several separate runs of segments (a
 * subroutine called twice, a canned cycle), so each line maps to a list of runs.
 */
export interface LineIndex {
  /** Segment runs [start, end) drawn by a main-program line; empty if it draws nothing. */
  segmentsOf(line: number): readonly (readonly [number, number])[];
  /** The main-program line that drew segment `s`, or 0 (none, or a subprogram file). */
  lineOf(segment: number): number;
}

export function buildLineIndex(p: LoadedProgram): LineIndex {
  const runs = new Map<number, [number, number][]>();
  const n = Math.max(0, p.count - 1);
  let current = 0;
  let start = 0;
  const close = (end: number) => {
    if (current === 0 || end <= start) return;
    const list = runs.get(current);
    if (list) list.push([start, end]);
    else runs.set(current, [[start, end]]);
  };
  for (let s = 0; s < n; s++) {
    const line = p.vertexLine[s + 1] as number;
    if (line !== current) {
      close(s);
      current = line;
      start = s;
    }
  }
  close(n);
  return {
    segmentsOf: (line) => runs.get(line) ?? [],
    lineOf: (segment) => (segment >= 0 && segment < n ? (p.vertexLine[segment + 1] as number) : 0),
  };
}
