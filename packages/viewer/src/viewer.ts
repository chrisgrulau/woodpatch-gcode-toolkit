// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import {
  Color,
  GridHelper,
  Group,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { buildSegments, DEFAULT_PALETTE, type Palette } from './geometry.js';
import { buildLineIndex, type LineIndex } from './lineIndex.js';
import type { LoadedProgram } from './program.js';
import { fitDistance, gridSpec, VIEW_DIRECTIONS, type ViewName } from './view.js';

export interface ViewerOptions {
  readonly palette?: Partial<Palette>;
  /** Path line width in CSS pixels (real width: upstream's 1.5 was ignored, R12). Default 1.5. */
  readonly lineWidth?: number;
  /** Highlighted line width in CSS pixels. Default 4. */
  readonly highlightWidth?: number;
  /** How close (CSS px) a click must be to a segment to pick it. Default 6. */
  readonly pickRadius?: number;
}

/** A clicked point of the path: the source line that drew it (0: none / another file). */
export interface PickEvent {
  readonly line: number;
  readonly segment: number;
}

/**
 * The 3D view (parcel 3a, ADR-0026). Framework-free: give it a container element,
 * then `setProgram()` with a {@link LoadedProgram} (from `loadProgram` or the worker).
 *
 * - WebGL2 via three.js, with LineSegments2 for REAL line widths (fixes R12).
 * - Z up, orbit/pan/zoom, fit to the path, standard views, a grid at machine Z0.
 * - `highlightLine(n)` draws line n's segments on top; clicks report the line picked.
 * - Renders on demand (after a change), not every frame: idle costs nothing.
 */
export class GcodeViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.1, 100_000);
  private readonly controls: OrbitControls;
  private readonly world = new Group();
  private readonly palette: Palette;
  private readonly pathMaterial: LineMaterial;
  private readonly highlightMaterial: LineMaterial;
  private readonly observer: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly pickListeners = new Set<(e: PickEvent) => void>();
  private path: LineSegments2 | null = null;
  private highlight: LineSegments2 | null = null;
  private grid: GridHelper | null = null;
  private index: LineIndex | null = null;
  private program: LoadedProgram | null = null;
  private radius = 100;
  private frame = 0;
  private down: { x: number; y: number } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ViewerOptions = {},
  ) {
    this.palette = { ...DEFAULT_PALETTE, ...options.palette };
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(globalThis.devicePixelRatio ?? 1);
    this.renderer.setClearColor(new Color(this.palette.background));
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.camera.up.set(0, 0, 1); // CNC convention: Z up
    this.scene.add(this.world);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());

    this.pathMaterial = new LineMaterial({
      linewidth: options.lineWidth ?? 1.5,
      vertexColors: true,
      worldUnits: false,
    });
    this.highlightMaterial = new LineMaterial({
      linewidth: options.highlightWidth ?? 4,
      color: this.palette.highlight,
      worldUnits: false,
      depthTest: false, // always visible, even behind other cuts
    });
    this.raycaster.params.Line2 = { threshold: options.pickRadius ?? 6 };

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  /** Shows a program, replacing any previous one, and fits the view to it. */
  setProgram(program: LoadedProgram): void {
    this.program = program;
    this.index = buildLineIndex(program);
    const seg = buildSegments(program, this.palette);
    this.disposePath();
    const geometry = new LineSegmentsGeometry();
    if (seg.segments > 0) {
      geometry.setPositions(seg.positions);
      geometry.setColors(seg.colors);
    }
    this.path = new LineSegments2(geometry, this.pathMaterial);
    this.world.add(this.path);
    this.placeGrid(seg.origin);
    this.setView('iso');
  }

  /** Draws one source line's segments highlighted, or clears the highlight (null). */
  highlightLine(line: number | null): void {
    if (this.highlight) {
      this.world.remove(this.highlight);
      this.highlight.geometry.dispose();
      this.highlight = null;
    }
    const runs = line && this.index ? this.index.segmentsOf(line) : [];
    if (runs.length > 0 && this.path) {
      const src = (this.path.geometry as LineSegmentsGeometry).getAttribute('instanceStart');
      const array = (src as unknown as { data: { array: Float32Array } }).data.array;
      const count = runs.reduce((n, [a, b]) => n + (b - a), 0);
      const pos = new Float32Array(count * 6);
      let o = 0;
      for (const [a, b] of runs) {
        pos.set(array.subarray(a * 6, b * 6), o);
        o += (b - a) * 6;
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(pos);
      this.highlight = new LineSegments2(geometry, this.highlightMaterial);
      this.highlight.renderOrder = 1;
      this.world.add(this.highlight);
    }
    this.requestRender();
  }

  /** Listens for clicks on the path. Returns a function that stops listening. */
  onPick(listener: (e: PickEvent) => void): () => void {
    this.pickListeners.add(listener);
    return () => this.pickListeners.delete(listener);
  }

  /** Points the camera along a standard direction, framing the whole path. */
  setView(view: ViewName): void {
    const b = this.program?.bounds.all;
    const size = b ? [b.max.X - b.min.X, b.max.Y - b.min.Y, b.max.Z - b.min.Z] : [100, 100, 10];
    this.radius = Math.max(1, Math.hypot(size[0] ?? 0, size[1] ?? 0, size[2] ?? 0) / 2);
    const [dx, dy, dz] = VIEW_DIRECTIONS[view];
    const d = fitDistance(this.radius, this.camera.fov, this.camera.aspect);
    this.camera.position.set(dx * d, dy * d, dz * d);
    this.camera.near = Math.max(0.01, d / 1000);
    this.camera.far = d * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  /** Call if the container's size changed without the ResizeObserver seeing it. */
  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pathMaterial.resolution.set(w, h);
    this.highlightMaterial.resolution.set(w, h);
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.disposePath();
    this.highlight?.geometry.dispose();
    this.grid?.geometry.dispose();
    this.pathMaterial.dispose();
    this.highlightMaterial.dispose();
    this.renderer.dispose();
    el.remove();
    this.pickListeners.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private disposePath(): void {
    if (this.path) {
      this.world.remove(this.path);
      this.path.geometry.dispose();
      this.path = null;
    }
    this.highlightLine(null);
  }

  /** A grid on the machine's Z0 plane, sized to the path (upstream's orange grid). */
  private placeGrid(origin: readonly [number, number, number]): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    const b = this.program?.bounds.all;
    const spec = gridSpec(b ? Math.max(b.max.X - b.min.X, b.max.Y - b.min.Y) : 100);
    this.grid = new GridHelper(spec.size, spec.divisions, this.palette.grid, this.palette.grid);
    this.grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; the machine's table is XY
    this.grid.position.set(0, 0, -origin[2]);
    this.scene.add(this.grid);
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  /** A click (not a drag, which orbits) picks the nearest segment under the pointer. */
  private readonly onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !this.path || !this.index) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.path, false);
    const hit = hits[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return;
    const event = { segment: hit.faceIndex, line: this.index.lineOf(hit.faceIndex) };
    for (const l of this.pickListeners) l(event);
  };
}
