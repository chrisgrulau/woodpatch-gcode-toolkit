// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { ExpressionRules } from '../expr/rules.js';
import type { InterpreterRules } from './rules.js';
import type { Diagnostic } from '../syntax/types.js';

/** The axes the interpreter tracks. XYZ move the tool; ABC are tracked but not simulated. */
export const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;
export type Axis = (typeof AXES)[number];

/** A position on every tracked axis, in millimetres (ABC in degrees). */
export type Position = Readonly<Record<Axis, number>>;

export type Plane = 'XY' | 'ZX' | 'YZ';

/**
 * How a motion's feed is expressed (G94 / G93 / G95), converted to millimetres
 * where it's a length. `null` feed on a rapid: rapids run at the machine's rate,
 * which is Phase 5's business, not the program's.
 */
export type Feed =
  | { readonly mode: 'per-minute'; readonly mmPerMinute: number }
  | { readonly mode: 'inverse-time'; readonly perMinute: number }
  | { readonly mode: 'per-revolution'; readonly mmPerRevolution: number };

/**
 * One thing the program makes the machine do, in execution order.
 *
 * Positions are MACHINE coordinates in millimetres (ADR-0019). `offset` is the total
 * work offset in force (coordinate system + G92/G52), so work coordinates are
 * `position - offset`. That lets G53, G10, G92 and coordinate-system changes compose
 * exactly, while a viewer can still draw in work coordinates.
 */
export type Step =
  | {
      readonly kind: 'linear';
      readonly line: number;
      readonly rapid: boolean;
      readonly from: Position;
      readonly to: Position;
      readonly feed: Feed | null;
      readonly offset: Position;
    }
  | {
      readonly kind: 'arc';
      readonly line: number;
      readonly from: Position;
      readonly to: Position;
      readonly plane: Plane;
      readonly clockwise: boolean;
      /** Centre in machine coordinates, when given by I/J/K. */
      readonly centre: Position | null;
      /** Signed radius in mm, when given by R (negative: the major arc). */
      readonly radius: number | null;
      /** Full turns from P (default 1). */
      readonly turns: number;
      readonly feed: Feed;
      readonly offset: Position;
    }
  | { readonly kind: 'dwell'; readonly line: number; readonly seconds: number }
  | { readonly kind: 'tool-change'; readonly line: number; readonly tool: number | null }
  | {
      readonly kind: 'spindle';
      readonly line: number;
      readonly state: 'cw' | 'ccw' | 'off';
      readonly rpm: number | null;
    }
  | {
      readonly kind: 'coolant';
      readonly line: number;
      readonly mist: boolean;
      readonly flood: boolean;
    }
  | { readonly kind: 'pause'; readonly line: number; readonly optional: boolean }
  | { readonly kind: 'end'; readonly line: number; readonly by: 'M2' | 'M30' | '%' };

export interface InterpretOptions {
  /** Expression rules (ADR-0018). Default: LINUXCNC_RULES. */
  readonly rules?: ExpressionRules;
  /** Controller-dependent interpreter behaviour (ADR-0019). Default: LINUXCNC_INTERPRETER_RULES. */
  readonly interpreterRules?: InterpreterRules;
  /** The block-delete ("optional skip") switch: when on, lines starting "/" are skipped. Default: on. */
  readonly blockDelete?: boolean;
  /** Machine position before the first line. Default: all zeros. */
  readonly start?: Partial<Position>;
}

/** The modal state after the last line: useful for tests, editors and resuming. */
export interface ModalState {
  readonly motion: 'G0' | 'G1' | 'G2' | 'G3' | 'G80';
  readonly plane: Plane;
  readonly units: 'mm' | 'inch';
  readonly distance: 'absolute' | 'incremental';
  readonly arcDistance: 'absolute' | 'incremental';
  readonly feedMode: 'per-minute' | 'inverse-time' | 'per-revolution';
  readonly coordinateSystem: number;
  readonly cutterCompensation: 'off' | 'left' | 'right';
  readonly toolLengthOffset: boolean;
  readonly retract: 'initial' | 'r-plane';
  readonly pathControl: 'G61' | 'G61.1' | 'G64';
  readonly position: Position;
  /** Feed rate in mm/min, (inverse time: per minute; per rev: mm/rev), or null if never set. */
  readonly feedRate: number | null;
  readonly spindle: { readonly state: 'cw' | 'ccw' | 'off'; readonly rpm: number | null };
  readonly tool: number | null;
}

export interface InterpretResult {
  readonly steps: readonly Step[];
  /**
   * The interpreter's own findings, including expression-evaluation errors. Syntax
   * findings stay on the {@link Program} they came from; show both together.
   */
  readonly diagnostics: readonly Diagnostic[];
  readonly state: ModalState;
}
