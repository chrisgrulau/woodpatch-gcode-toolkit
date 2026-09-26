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
- A new `load()` cancels the one in flight by terminating its worker, so a huge or
  hostile file can't hold the page.
