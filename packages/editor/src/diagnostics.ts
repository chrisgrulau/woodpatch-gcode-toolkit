// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import type { Diagnostic } from '@woodpatch/gcode-core';

/**
 * The core's diagnostics as CodeMirror lint diagnostics (document offsets).
 *
 * - A span covers just the words concerned; without one, the whole line.
 * - The core reads line 1 without a byte-order mark; if the document keeps it, the
 *   offsets shift by one there.
 * - Line 0 (whole-program notes) attaches to line 1.
 * - Diagnostics from a subprogram FILE belong to another file's lines, so they're
 *   left out here; `skipped` counts them so a host can say so.
 */
export function toLintDiagnostics(
  doc: Text,
  diagnostics: readonly Diagnostic[],
): { diagnostics: LintDiagnostic[]; skipped: number } {
  const out: LintDiagnostic[] = [];
  let skipped = 0;
  const bom = doc.sliceString(0, 1) === '﻿' ? 1 : 0;
  for (const d of diagnostics) {
    if (d.file !== undefined) {
      skipped++;
      continue;
    }
    const n = Math.min(Math.max(d.line, 1), doc.lines);
    const line = doc.line(n);
    const shift = n === 1 ? bom : 0;
    const len = line.length - shift;
    let from = line.from + shift;
    let to = line.to;
    if (d.span && d.line >= 1) {
      from = line.from + shift + Math.min(Math.max(d.span.start, 0), len);
      to = line.from + shift + Math.min(Math.max(d.span.end, d.span.start), len);
    }
    out.push({ from, to, severity: d.severity, message: d.message, source: d.code });
  }
  return { diagnostics: out, skipped };
}
