// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * @woodpatch/gcode-viewer: the 3D view of a G-code program (parcel 3a, ADR-0026).
 * Framework-free. three.js is a peer dependency: the host app provides it, so a page
 * never carries two copies.
 */
export { GcodeViewer, type PickEvent, type ViewerOptions } from './viewer.js';
export { ProgramLoader, type WorkerLike } from './client.js';
export { loadProgram, transferables, type LoadOptions, type LoadedProgram } from './program.js';
export { buildSegments, DEFAULT_PALETTE, type Palette, type SegmentBuffers } from './geometry.js';
export { buildLineIndex, type LineIndex } from './lineIndex.js';
export { fitDistance, gridSpec, VIEW_DIRECTIONS, type ViewName } from './view.js';
export type { LoadRequest, LoadResponse } from './worker.js';
