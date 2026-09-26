// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ProgramLoader, type WorkerLike } from './client.js';
import { handle, type LoadRequest, type LoadResponse } from './worker.js';

/** A stand-in worker: answers when told to, and records termination. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<LoadResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  inbox: LoadRequest[] = [];
  postMessage(m: LoadRequest): void {
    this.inbox.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(req = this.inbox.shift()): void {
    if (!req) throw new Error('nothing to answer');
    this.onmessage?.({ data: handle(req).response } as MessageEvent<LoadResponse>);
  }
}

describe('ProgramLoader', () => {
  it('loads through the worker', async () => {
    const w = new FakeWorker();
    const loader = new ProgramLoader(() => w);
    const p = loader.load('G0 X5', { dialect: 'linuxcnc-2.9' });
    w.answer();
    const program = await p;
    expect(program.dialect).toBe('linuxcnc-2.9');
    expect(program.bounds.all?.max.X).toBe(5);
  });

  it('cancels a load in flight by terminating its worker when a newer load starts', async () => {
    const made: FakeWorker[] = [];
    const loader = new ProgramLoader(() => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    });
    const first = loader.load('G0 X1');
    const second = loader.load('G0 X2');
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(made[0]?.terminated).toBe(true);
    made[1]?.answer();
    expect((await second).bounds.all?.max.X).toBe(2);
  });

  it('ignores a stale reply, and honours an abort signal', async () => {
    const w = new FakeWorker();
    const loader = new ProgramLoader(() => w);
    const ctrl = new AbortController();
    const p = loader.load('G0 X1', {}, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.terminated).toBe(true);
    const pre = new AbortController();
    pre.abort();
    await expect(loader.load('G0 X1', {}, pre.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects when the worker fails, and starts a fresh one next time', async () => {
    const made: FakeWorker[] = [];
    const loader = new ProgramLoader(() => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    });
    const p = loader.load('G0 X1');
    made[0]?.onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(p).rejects.toThrow('Worker failed: boom');
    const q = loader.load('G0 X3');
    expect(made).toHaveLength(2);
    made[1]?.answer();
    expect((await q).bounds.all?.max.X).toBe(3);
  });
});
