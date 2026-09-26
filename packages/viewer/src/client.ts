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

export interface LoaderOptions {
  /**
   * The time budget for one load, in ms (plan §4.8: "time budget with cancellation").
   * Past it the worker is terminated and the load rejects with a TimeoutError. The
   * core's own limits bound the work, but not the wall-clock on a slow device. aztec
   * (224k lines) loads in about 1.2 s. Default 30,000; 0 turns the budget off.
   */
  readonly timeoutMs?: number;
}

interface Pending {
  readonly id: number;
  readonly resolve: (p: LoadedProgram) => void;
  readonly reject: (e: Error) => void;
  /** Removes this load's abort listener and timer. Called exactly once, on settle. */
  readonly cleanup: () => void;
}

/**
 * Loads programs in a worker (ADR-0026). One load at a time: a new load, an abort, or
 * the time budget TERMINATES the worker running the old one and starts a fresh worker.
 * That's the only way to stop a parse mid-way, and it's what keeps a huge or hostile
 * file from holding the page.
 *
 * Each load's abort listener and timer belong to THAT load: they're removed when it
 * settles, and they only ever cancel their own load (reviewer, toolkit #20). So a host
 * can reuse one AbortSignal for a component's lifetime, or abort a finished load's
 * controller, without touching a newer load.
 */
export class ProgramLoader {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending: Pending | null = null;
  private readonly timeoutMs: number;

  /** `factory` makes the worker, e.g. `() => new Worker(new URL(...), { type: 'module' })`. */
  constructor(
    private readonly factory: () => WorkerLike,
    options: LoaderOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  load(text: string, options: LoadOptions = {}, signal?: AbortSignal): Promise<LoadedProgram> {
    this.cancel('superseded by a newer load');
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Load aborted', 'AbortError'));
        return;
      }
      const id = this.nextId++;
      // Cancels only ITS load. Settling removes the listener anyway (cleanup), so the
      // id check is a second guard, belt and braces, not the primary mechanism.
      const onAbort = () => {
        if (this.pending?.id === id) this.cancel('aborted');
      };
      const timer =
        this.timeoutMs > 0
          ? setTimeout(() => {
              if (this.pending?.id === id)
                this.cancel(`timed out after ${this.timeoutMs} ms`, 'TimeoutError');
            }, this.timeoutMs)
          : undefined;
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        if (timer !== undefined) clearTimeout(timer);
      };
      this.pending = { id, resolve, reject, cleanup };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.ensureWorker().postMessage({ id, text, options });
    });
  }

  /** Stops the load in flight, if any (its promise rejects with an AbortError). */
  cancel(why = 'cancelled', name: 'AbortError' | 'TimeoutError' = 'AbortError'): void {
    const p = this.settle();
    if (!p) return;
    this.worker?.terminate();
    this.worker = null;
    p.reject(new DOMException(`Load ${why}`, name));
  }

  dispose(): void {
    this.cancel('disposed');
    this.worker?.terminate();
    this.worker = null;
  }

  /** Takes the pending load, removing its listener and timer. */
  private settle(): Pending | null {
    const p = this.pending;
    this.pending = null;
    p?.cleanup();
    return p;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.factory();
    w.onmessage = (e) => {
      if (!this.pending || e.data.id !== this.pending.id) return; // a stale reply
      const p = this.settle();
      if (!p) return;
      if (e.data.ok) p.resolve(e.data.program);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      const p = this.settle();
      this.worker = null;
      w.terminate();
      p?.reject(new Error(`Worker failed: ${e.message}`));
    };
    this.worker = w;
    return w;
  }
}
