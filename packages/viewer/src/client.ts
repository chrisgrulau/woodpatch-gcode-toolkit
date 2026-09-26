// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { LoadOptions, LoadedProgram } from './program.js';
import type { LoadRequest, LoadResponse } from './worker.js';

/** The part of a Worker the loader uses (so tests can pass a stand-in). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<LoadResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: LoadRequest): void;
  terminate(): void;
}

/**
 * Loads programs in a worker (ADR-0026). One load at a time: a new load, or an abort,
 * TERMINATES the worker running the old one and starts a fresh worker. That's the
 * only way to stop a parse mid-way, and it's what keeps a huge or hostile file from
 * holding the page (plan §4.8: "time budget with cancellation").
 */
export class ProgramLoader {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (p: LoadedProgram) => void;
    reject: (e: Error) => void;
  } | null = null;

  /** `factory` makes the worker, e.g. `() => new Worker(new URL(...), { type: 'module' })`. */
  constructor(private readonly factory: () => WorkerLike) {}

  load(text: string, options: LoadOptions = {}, signal?: AbortSignal): Promise<LoadedProgram> {
    this.cancel('superseded by a newer load');
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Load aborted', 'AbortError'));
        return;
      }
      const id = this.nextId++;
      this.pending = { id, resolve, reject };
      const w = this.ensureWorker();
      signal?.addEventListener('abort', () => this.cancel('aborted'), { once: true });
      w.postMessage({ id, text, options });
    });
  }

  /** Stops the load in flight, if any (its promise rejects with an AbortError). */
  cancel(why = 'cancelled'): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    p.reject(new DOMException(`Load ${why}`, 'AbortError'));
  }

  dispose(): void {
    this.cancel('disposed');
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.factory();
    w.onmessage = (e) => {
      const p = this.pending;
      if (!p || e.data.id !== p.id) return; // a stale reply from a superseded load
      this.pending = null;
      if (e.data.ok) p.resolve(e.data.program);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      const p = this.pending;
      this.pending = null;
      this.worker = null;
      w.terminate();
      p?.reject(new Error(`Worker failed: ${e.message}`));
    };
    this.worker = w;
    return w;
  }
}
