import type { Cell, Point } from '../model/types';
import {
  type Camera,
  type Viewport,
  cellToScreen as cameraCellToScreen,
  clampCamera,
  createCamera,
  fit,
  panBy,
  screenToCell as cameraScreenToCell,
  toScreen as cameraToScreen,
  toWorld,
  visibleBounds,
  zoomAt,
} from './camera';

/** The view state handed to every layer draw call. */
export interface BoardView extends Viewport {
  camera: Camera;
  dpr: number;
}

/**
 * A layer draw function. The context is already transformed into world units,
 * so 1 unit is one grid cell and the top-left corner of cell (0, 0) is (0, 0).
 */
export type LayerDraw = (ctx: CanvasRenderingContext2D, view: BoardView) => void;

export interface PointerInfo {
  /** Board-relative position in CSS pixels. */
  screen: Point;
  /** Position in world units (1 = one cell). */
  world: Point;
  /** Cell under the pointer (may be outside the grid). */
  cell: Cell;
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  /** True when this event belongs to an active camera pan. */
  panning: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type PointerHandler = (info: PointerInfo) => void;

export interface BoardColours {
  outside: string;
  grass: string;
  grid: string;
  gridMajor: string;
}

export interface BoardOptions {
  cols: number;
  rows: number;
  /** Override the device pixel ratio (used by tests). */
  dpr?: number;
  colours?: Partial<BoardColours>;
}

export interface Board {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera;
  readonly cols: number;
  readonly rows: number;
  /** Snapshot of the current view. */
  view(): BoardView;
  /** Fit the whole grid in the viewport, centred. */
  fit(): void;
  /** Ask for a redraw on the next animation frame. */
  markDirty(): void;
  /**
   * Turn continuous animation frames on or off. While any layer asks for
   * frames the board keeps redrawing; an idle board stops on its own.
   */
  requestAnimation(on: boolean): void;
  /** Register a layer. Higher `z` draws later (on top). Returns an unsubscribe. */
  addLayer(z: number, draw: LayerDraw): () => void;
  screenToCell(screen: Point): Cell;
  screenToWorld(screen: Point): Point;
  cellToScreen(cell: Cell): Point;
  worldToScreen(world: Point): Point;
  /** Total number of frames drawn since the board was created. */
  frames(): number;
  onPointerDown(handler: PointerHandler): () => void;
  onPointerMove(handler: PointerHandler): () => void;
  onPointerUp(handler: PointerHandler): () => void;
  onPointerLeave(handler: PointerHandler): () => void;
  destroy(): void;
}

const DEFAULT_COLOURS: BoardColours = {
  outside: '#6f9f52',
  grass: '#a9d98b',
  grid: 'rgba(255, 255, 255, 0.38)',
  gridMajor: 'rgba(66, 104, 42, 0.24)',
};

const MAJOR_GRID_EVERY = 4;
const WHEEL_ZOOM_SPEED = 0.0015;
const MIN_VISIBLE = 0.15;

type PointerKind = 'down' | 'move' | 'up' | 'leave';

interface ActivePointer {
  point: Point;
  pointerType: string;
}

interface LayerEntry {
  z: number;
  draw: LayerDraw;
}

interface PinchState {
  idA: number;
  idB: number;
  startDistance: number;
  startCamera: Camera;
  startCenter: Point;
}

type SafariGestureEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

export function createBoard(canvas: HTMLCanvasElement, options: BoardOptions): Board {
  const context = require2dContext(canvas);

  const cols = Math.max(1, Math.floor(options.cols));
  const rows = Math.max(1, Math.floor(options.rows));
  const colours: BoardColours = { ...DEFAULT_COLOURS, ...options.colours };
  const dprOverride = options.dpr;

  let camera = createCamera();
  let viewport: Viewport = { width: 0, height: 0 };
  let dpr = dprOverride ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  let fitted = false;

  let dirty = true;
  let animating = false;
  let rafId = 0;
  let frameCount = 0;

  const layers: LayerEntry[] = [];
  const pointerHandlers: Record<PointerKind, Set<PointerHandler>> = {
    down: new Set(),
    move: new Set(),
    up: new Set(),
    leave: new Set(),
  };

  const activePointers = new Map<number, ActivePointer>();
  let panPointerId: number | null = null;
  let panLast: Point | null = null;
  let pinch: PinchState | null = null;
  let spaceHeld = false;
  let gestureBase: { camera: Camera; scale: number } | null = null;

  // --- rendering ---------------------------------------------------------

  function snapshot(): BoardView {
    return {
      camera: { ...camera },
      width: viewport.width,
      height: viewport.height,
      dpr,
    };
  }

  function schedule(): void {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(tick);
  }

  function markDirty(): void {
    dirty = true;
    schedule();
  }

  function requestAnimation(on: boolean): void {
    animating = on;
    if (on) schedule();
  }

  function tick(): void {
    rafId = 0;
    if (!dirty && !animating) return;
    dirty = false;
    draw();
    frameCount += 1;
    if (dirty || animating) schedule();
  }

  function snapToDevice(css: number, ratio: number, thickness: number): number {
    const device = css * ratio;
    return (Math.round(device - thickness / 2) + thickness / 2) / ratio;
  }

  function drawGrid(ctx: CanvasRenderingContext2D, view: BoardView): void {
    const ratio = view.dpr;
    const scale = view.camera.scale;
    const thickness = Math.max(1, Math.round(ratio));
    const lineWidth = thickness / (ratio * scale);

    const minX = Math.max(0, Math.floor((0 - view.camera.x) / scale));
    const maxX = Math.min(cols, Math.ceil((view.width - view.camera.x) / scale));
    const minY = Math.max(0, Math.floor((0 - view.camera.y) / scale));
    const maxY = Math.min(rows, Math.ceil((view.height - view.camera.y) / scale));

    const vertical = (i: number): number =>
      (snapToDevice(view.camera.x + i * scale, ratio, thickness) - view.camera.x) / scale;
    const horizontal = (j: number): number =>
      (snapToDevice(view.camera.y + j * scale, ratio, thickness) - view.camera.y) / scale;

    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    for (let i = minX; i <= maxX; i += 1) {
      const x = vertical(i);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows);
    }
    for (let j = minY; j <= maxY; j += 1) {
      const y = horizontal(j);
      ctx.moveTo(0, y);
      ctx.lineTo(cols, y);
    }
    ctx.strokeStyle = colours.grid;
    ctx.stroke();

    ctx.beginPath();
    for (let i = Math.ceil(minX / MAJOR_GRID_EVERY) * MAJOR_GRID_EVERY; i <= maxX; i += MAJOR_GRID_EVERY) {
      const x = vertical(i);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows);
    }
    for (let j = Math.ceil(minY / MAJOR_GRID_EVERY) * MAJOR_GRID_EVERY; j <= maxY; j += MAJOR_GRID_EVERY) {
      const y = horizontal(j);
      ctx.moveTo(0, y);
      ctx.lineTo(cols, y);
    }
    ctx.strokeStyle = colours.gridMajor;
    ctx.stroke();
  }

  function drawBackground(ctx: CanvasRenderingContext2D, view: BoardView): void {
    const bounds = visibleBounds(view.camera, view);
    const pad = 2 / view.camera.scale;

    ctx.fillStyle = colours.outside;
    ctx.fillRect(
      bounds.min.x - pad,
      bounds.min.y - pad,
      bounds.max.x - bounds.min.x + pad * 2,
      bounds.max.y - bounds.min.y + pad * 2,
    );

    ctx.fillStyle = colours.grass;
    ctx.fillRect(0, 0, cols, rows);

    drawGrid(ctx, view);
  }

  function applyWorldTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(
      dpr * camera.scale,
      0,
      0,
      dpr * camera.scale,
      dpr * camera.x,
      dpr * camera.y,
    );
  }

  function draw(): void {
    const view = snapshot();

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    context.save();
    applyWorldTransform(context);
    drawBackground(context, view);
    context.restore();

    for (const layer of layers) {
      context.save();
      applyWorldTransform(context);
      layer.draw(context, view);
      context.restore();
    }
  }

  // --- sizing ------------------------------------------------------------

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    dpr = dprOverride ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    viewport = { width: rect.width, height: rect.height };

    const backingWidth = Math.max(1, Math.round(rect.width * dpr));
    const backingHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;

    if (!fitted) {
      camera = fit(cols, rows, viewport);
      fitted = true;
    } else {
      camera = clampCamera(camera, viewport, cols, rows, MIN_VISIBLE);
    }
    markDirty();
  }

  // --- camera helpers ----------------------------------------------------

  function applyCamera(next: Camera): void {
    camera = clampCamera(next, viewport, cols, rows, MIN_VISIBLE);
    markDirty();
  }

  function fitView(): void {
    if (viewport.width <= 0 || viewport.height <= 0) return;
    camera = fit(cols, rows, viewport);
    fitted = true;
    markDirty();
  }

  // --- pointer input -----------------------------------------------------

  function boardPoint(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function emitPointer(kind: PointerKind, event: PointerEvent, point: Point): void {
    const handlers = pointerHandlers[kind];
    if (handlers.size === 0) return;
    const world = toWorld(camera, point);
    const info: PointerInfo = {
      screen: point,
      world,
      cell: { x: Math.floor(world.x), y: Math.floor(world.y) },
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      buttons: event.buttons,
      panning: panPointerId === event.pointerId,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
    for (const handler of [...handlers]) handler(info);
  }

  function capture(id: number): void {
    try {
      canvas.setPointerCapture(id);
    } catch {
      // Synthetic pointers dispatched in tests cannot be captured.
    }
  }

  function release(id: number): void {
    try {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      // Ignore pointers that were never captured.
    }
  }

  function touchPointers(): Array<[number, ActivePointer]> {
    return [...activePointers.entries()].filter(
      ([, pointer]) => pointer.pointerType === 'touch',
    );
  }

  function handlePointerDown(event: PointerEvent): void {
    const point = boardPoint(event);
    activePointers.set(event.pointerId, { point, pointerType: event.pointerType });
    emitPointer('down', event, point);

    if (event.pointerType === 'touch') {
      const touches = touchPointers();
      if (touches.length === 2) {
        const [a, b] = touches;
        pinch = {
          idA: a[0],
          idB: b[0],
          startDistance: Math.max(1, distance(a[1].point, b[1].point)),
          startCamera: { ...camera },
          startCenter: midpoint(a[1].point, b[1].point),
        };
        capture(a[0]);
        capture(b[0]);
      }
      return;
    }

    const wantsPan =
      event.button === 1 ||
      event.button === 2 ||
      (spaceHeld && event.button === 0);
    if (wantsPan) {
      panPointerId = event.pointerId;
      panLast = point;
      capture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    const point = boardPoint(event);
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { point, pointerType: event.pointerType });
    }
    emitPointer('move', event, point);

    if (panPointerId === event.pointerId && panLast) {
      applyCamera(panBy(camera, point.x - panLast.x, point.y - panLast.y));
      panLast = point;
      return;
    }

    if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
      const a = activePointers.get(pinch.idA);
      const b = activePointers.get(pinch.idB);
      if (!a || !b) return;
      const center = midpoint(a.point, b.point);
      const factor = Math.max(1, distance(a.point, b.point)) / pinch.startDistance;
      const zoomed = zoomAt(pinch.startCamera, pinch.startCenter, factor);
      applyCamera(panBy(zoomed, center.x - pinch.startCenter.x, center.y - pinch.startCenter.y));
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    emitPointer('up', event, boardPoint(event));
    activePointers.delete(event.pointerId);
    if (panPointerId === event.pointerId) {
      panPointerId = null;
      panLast = null;
      canvas.style.cursor = spaceHeld ? 'grab' : '';
    }
    if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
      pinch = null;
    }
    release(event.pointerId);
  }

  function handlePointerLeave(event: PointerEvent): void {
    emitPointer('leave', event, boardPoint(event));
  }

  function normalizeWheel(event: WheelEvent): number {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
    return event.deltaY * unit;
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = boardPoint(event);
    const factor = Math.exp(-normalizeWheel(event) * WHEEL_ZOOM_SPEED);
    applyCamera(zoomAt(camera, point, factor));
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space') return;
    if (isInteractiveTarget(event.target)) return;
    if (event.repeat) return;
    spaceHeld = true;
    if (panPointerId === null) canvas.style.cursor = 'grab';
    event.preventDefault();
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'Space') return;
    spaceHeld = false;
    if (panPointerId === null) canvas.style.cursor = '';
  }

  function handleContextMenu(event: Event): void {
    event.preventDefault();
  }

  function handleGestureStart(event: Event): void {
    event.preventDefault();
    gestureBase = { camera: { ...camera }, scale: (event as SafariGestureEvent).scale ?? 1 };
  }

  function handleGestureChange(event: Event): void {
    event.preventDefault();
    if (!gestureBase) return;
    const gesture = event as SafariGestureEvent;
    const ratio = (gesture.scale ?? 1) / gestureBase.scale;
    const point = boardPoint({
      clientX: gesture.clientX ?? viewport.width / 2,
      clientY: gesture.clientY ?? viewport.height / 2,
    });
    applyCamera(zoomAt(gestureBase.camera, point, ratio));
  }

  function handleGestureEnd(event: Event): void {
    event.preventDefault();
    gestureBase = null;
  }

  // --- wiring ------------------------------------------------------------

  const onPointerDown = handlePointerDown as EventListener;
  const onPointerMove = handlePointerMove as EventListener;
  const onPointerUp = handlePointerUp as EventListener;
  const onPointerCancel = handlePointerUp as EventListener;
  const onPointerLeave = handlePointerLeave as EventListener;
  const onWheel = handleWheel as EventListener;
  const onContextMenu = handleContextMenu as EventListener;
  const onGestureStart = handleGestureStart as EventListener;
  const onGestureChange = handleGestureChange as EventListener;
  const onGestureEnd = handleGestureEnd as EventListener;
  const onKeyDown = handleKeyDown as EventListener;
  const onKeyUp = handleKeyUp as EventListener;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('gesturestart', onGestureStart);
  canvas.addEventListener('gesturechange', onGestureChange);
  canvas.addEventListener('gestureend', onGestureEnd);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas);
  }
  window.addEventListener('resize', resize);
  resize();

  const board: Board = {
    canvas,
    get camera() {
      return camera;
    },
    cols,
    rows,
    view: snapshot,
    fit: fitView,
    markDirty,
    requestAnimation,
    addLayer(z: number, draw: LayerDraw): () => void {
      const entry: LayerEntry = { z, draw };
      layers.push(entry);
      layers.sort((a, b) => a.z - b.z);
      markDirty();
      return () => {
        const index = layers.indexOf(entry);
        if (index >= 0) {
          layers.splice(index, 1);
          markDirty();
        }
      };
    },
    screenToCell: (screen: Point) => cameraScreenToCell(camera, screen),
    screenToWorld: (screen: Point) => toWorld(camera, screen),
    cellToScreen: (cell: Cell) => cameraCellToScreen(camera, cell),
    worldToScreen: (world: Point) => cameraToScreen(camera, world),
    frames: () => frameCount,
    onPointerDown(handler: PointerHandler) {
      pointerHandlers.down.add(handler);
      return () => pointerHandlers.down.delete(handler);
    },
    onPointerMove(handler: PointerHandler) {
      pointerHandlers.move.add(handler);
      return () => pointerHandlers.move.delete(handler);
    },
    onPointerUp(handler: PointerHandler) {
      pointerHandlers.up.add(handler);
      return () => pointerHandlers.up.delete(handler);
    },
    onPointerLeave(handler: PointerHandler) {
      pointerHandlers.leave.add(handler);
      return () => pointerHandlers.leave.delete(handler);
    },
    destroy(): void {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      layers.length = 0;
      for (const handlers of Object.values(pointerHandlers)) handlers.clear();
    },
  };

  return board;
}

function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required for the board');
  return context;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    target.isContentEditable
  );
}
