// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import { loadProgram, transferables, type LoadOptions } from './program.js';

/**
 * The worker entry (`@woodpatch/gcode-viewer/worker`). Parsing a 224k-line file takes
 * most of a second; off the main thread the page stays responsive, and the result's
 * big arrays are transferred back rather than copied. A host creates it with its
 * bundler's worker syntax, e.g. in Vite:
 *
 *   new Worker(new URL('@woodpatch/gcode-viewer/worker', import.meta.url), { type: 'module' })
 *
 * and hands it to {@link ProgramLoader}.
 */
export interface LoadRequest {
  readonly id: number;
  readonly text: string;
  readonly options?: LoadOptions;
}

export type LoadResponse =
  | { readonly id: number; readonly ok: true; readonly program: ReturnType<typeof loadProgram> }
  | { readonly id: number; readonly ok: false; readonly error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LoadRequest>) => void) | null;
  postMessage(message: LoadResponse, transfer?: Transferable[]): void;
}

/** Handles one request. Exported for tests; the worker wires it to onmessage below. */
export function handle(req: LoadRequest): { response: LoadResponse; transfer: Transferable[] } {
  try {
    const program = loadProgram(req.text, req.options);
    return { response: { id: req.id, ok: true, program }, transfer: transferables(program) };
  } catch (e) {
    // The core never throws on bad G-code; this is for a genuine bug or out-of-memory.
    return {
      response: { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) },
      transfer: [],
    };
  }
}

const scope = globalThis as unknown as Partial<WorkerScope>;
// Only in a worker (a window has `document`); importing this module elsewhere is inert.
if (
  typeof (globalThis as { document?: unknown }).document === 'undefined' &&
  'postMessage' in scope
) {
  scope.onmessage = (e) => {
    const { response, transfer } = handle(e.data);
    scope.postMessage?.(response, transfer);
  };
}
