// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * The G and M codes the interpreter knows, and their modal groups (LinuxCNC G-code
 * overview, Tables 5 and 6). Two codes from the same group on one line is an error.
 *
 * Codes marked `later` are recognised but not yet interpreted. They produce a
 * clear error naming the parcel that adds them, and never a silent skip.
 * Dialect profiles (parcel 2e) restrict or extend this table per controller.
 */
export interface CodeInfo {
  /** Modal group, or 0 for non-modal (group 0). */
  readonly group: number;
  readonly later?: string;
}

const G = (group: number, codes: number[], later?: string): [string, CodeInfo][] =>
  codes.map((c) => [codeKey(c), later ? { group, later } : { group }]);

const LINUXCNC_G_TABLE: [string, CodeInfo][] = [
  ...G(0, [4, 10, 28, 28.1, 30, 30.1, 52, 53, 92, 92.1, 92.2, 92.3]),
  ...G(1, [0, 1, 2, 3, 80, 73, 81, 82, 83]),
  // LinuxCNC has these; Masso does not. Recognised, not interpreted yet.
  ...G(1, [84, 85, 86, 87, 88, 89], 'canned cycles G84-G89 (not implemented yet)'),
  ...G(2, [17, 18, 19]),
  ...G(3, [90, 91]),
  ...G(4, [90.1, 91.1]),
  ...G(5, [93, 94, 95]),
  ...G(6, [20, 21]),
  ...G(7, [40, 41, 42]),
  ...G(8, [43, 49]),
  ...G(10, [98, 99]),
  ...G(12, [54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3]),
  ...G(13, [61, 61.1, 64]),
];

const LINUXCNC_M_TABLE: [string, CodeInfo][] = [
  ...G(4, [0, 1, 2, 30, 60]),
  ...G(6, [6]),
  ...G(7, [3, 4, 5]),
  ...G(8, [7, 8, 9]),
  ...G(9, [48, 49]),
  ...G(5, [62, 63, 64, 65, 66, 67, 68]),
  // Subprogram call and return: per dialect (InterpreterRules.subprograms.m98).
  ...G(0, [98, 99]),
];

/** The codes LinuxCNC 2.9 has, of those known here (the LinuxCNC profile's list). */
export const LINUXCNC_G: readonly string[] = Object.freeze(LINUXCNC_G_TABLE.map(([k]) => k));
export const LINUXCNC_M: readonly string[] = Object.freeze(LINUXCNC_M_TABLE.map(([k]) => k));

/**
 * Every code known here: LinuxCNC's, plus codes other controllers have (Masso). A
 * dialect's `codes` list says which of these it accepts (parcel 2e-1, ADR-0023).
 */
export const G_CODES: ReadonlyMap<string, CodeInfo> = new Map([
  ...LINUXCNC_G_TABLE,
  // Masso: extended work offsets (G54.1 P1-P100).
  ...G(12, [54.1], 'extended work offsets (parcel 2e-2)'),
  // Masso: toolpath rotation, probing, lathe, laser and plasma.
  ...G(16, [68, 69], 'toolpath rotation is not simulated'),
  ...G(0, [38.2, 38.6, 38.7], 'probing depends on where the probe touches; not simulated'),
  ...G(1, [32], 'threading (lathe) is not simulated'),
  ...G(14, [96, 97], 'constant surface speed (lathe) is not simulated'),
  ...G(0, [200], 'laser and plasma parameters are not simulated'),
]);

export const M_CODES: ReadonlyMap<string, CodeInfo> = new Map([
  ...LINUXCNC_M_TABLE,
  // Masso: tool unload, clamp, door and plasma torch-height control.
  ...G(6, [6.1], 'tool unload (parcel 2e-2)'),
  ...G(5, [10, 11, 85, 86, 666, 667]),
]);

/** `1` → "1", `59.1` → "59.1", `1.0000001` → "1": codes are compared at one decimal. */
export function codeKey(value: number): string {
  return String(Math.round(value * 10) / 10);
}
