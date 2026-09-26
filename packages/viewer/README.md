<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# @woodpatch/gcode-viewer

The 3D view of a G-code program: three.js, framework-free, worker-backed (ADR-0026).

```ts
import { GcodeViewer, ProgramLoader } from '@woodpatch/gcode-viewer';

const loader = new ProgramLoader(
  () => new Worker(new URL('@woodpatch/gcode-viewer/worker', import.meta.url), { type: 'module' }),
);
const viewer = new GcodeViewer(document.getElementById('view')!);

viewer.setProgram(await loader.load(text, { dialect: 'generic' }));
viewer.onPick(({ line }) => console.log('clicked line', line));
viewer.highlightLine(42);
```

- **three.js is a peer dependency** (`>=0.186.0 <0.187.0`): your app provides it, so a
  page never carries two copies.
- Lines are drawn at a real width (`lineWidth`, CSS px), not WebGL's fixed 1 px.
- Rendering happens only after a change. An idle view costs nothing.
- **Cancellation and the time budget.** A new `load()`, an abort, or the loader's time
  budget (`new ProgramLoader(factory, { timeoutMs })`, default 30 s) terminates the busy
  worker, so a huge or hostile file can't hold the page. To give one load a shorter
  budget, pass `AbortSignal.timeout(ms)` as its signal.
- **Render diagnostics as text, never HTML.** A diagnostic's message can quote the
  G-code it's about, and a public file can contain anything.
- `dispose()` frees the WebGL context too, so views can be mounted and unmounted freely.
- If you write your own worker file, `import '@woodpatch/gcode-viewer/worker'` is kept
  by bundlers: the package declares that entry as having side effects.
