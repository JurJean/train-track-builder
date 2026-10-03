import './gallery.css';
import { debugHandles } from './app/debug';
import type { GhostMode } from './render/track-art';
import { drawPiece } from './render/track-art';
import { figureEightLayout, ovalLayout } from './render/samples';
import type { PieceKind, PlacedPiece, Point, Rotation } from './model/types';

/**
 * Dev gallery for the track art. It draws every kind at all four rotations, the
 * placement ghosts and a couple of connected samples on the grass background,
 * all through the same `drawPiece` the board uses. A zoom control proves the art
 * stays crisp from 20 to 96 pixels per cell.
 */

const KIND_ORDER: PieceKind[] = [
  'straight',
  'curve-sharp',
  'curve-gentle',
  'crossing',
  'bridge',
  'tunnel',
  'station',
  'buffer-stop',
];

const ROTATIONS: Rotation[] = [0, 1, 2, 3];
const ROTATION_LABELS = ['0°', '90°', '180°', '270°'];

const GHOST_KINDS: PieceKind[] = ['straight', 'curve-sharp', 'station'];
const GHOSTS: Array<GhostMode | undefined> = [undefined, 'valid', 'invalid'];
const GHOST_LABELS = ['solid', 'valid ghost', 'invalid ghost'];

const KINDS_ORIGIN: Point = { x: 1, y: 2 };
const KINDS_PITCH_X = 3;
const KINDS_PITCH_Y = 2.8;

const GHOSTS_ORIGIN: Point = { x: 1, y: 27 };
const GHOSTS_PITCH_X = 3;
const GHOSTS_PITCH_Y = 2.8;

const OVAL_AT: Point = { x: 1, y: 38 };
const FIGURE_EIGHT_AT: Point = { x: 8, y: 38 };

// World bounds of everything drawn, used to size and centre the canvas.
const WORLD_MIN: Point = { x: -0.4, y: -0.6 };
const WORLD_MAX: Point = { x: 14.2, y: 45 };
const TOP_PAD = 0.8;

const OUTSIDE = '#6f9f52';
const GRASS = '#a9d98b';
const GRID = 'rgba(255, 255, 255, 0.4)';
const GRID_MAJOR = 'rgba(66, 104, 42, 0.26)';
const INK = '#4f3d2e';
const TITLE = '#3f5f24';

interface GalleryItem {
  piece: PlacedPiece;
  ghost?: GhostMode;
}

interface GalleryLabel {
  at: Point;
  text: string;
  title?: boolean;
}

function translate(piece: PlacedPiece, dx: number, dy: number): PlacedPiece {
  return {
    ...piece,
    id: `${piece.id}@${dx},${dy}`,
    origin: { x: piece.origin.x + dx, y: piece.origin.y + dy },
  };
}

function buildScene(): { items: GalleryItem[]; labels: GalleryLabel[] } {
  const items: GalleryItem[] = [];
  const labels: GalleryLabel[] = [];
  let nextId = 0;
  const id = (): string => `g${nextId++}`;

  labels.push({ at: { x: 0, y: 0.3 }, text: 'Every kind at all four rotations', title: true });

  KIND_ORDER.forEach((kind, row) => {
    const y = KINDS_ORIGIN.y + row * KINDS_PITCH_Y;
    ROTATIONS.forEach((rotation, column) => {
      const x = KINDS_ORIGIN.x + column * KINDS_PITCH_X;
      items.push({ piece: { id: id(), kind, origin: { x, y }, rotation } });
      labels.push({ at: { x, y: y - 0.3 }, text: `${kind} ${ROTATION_LABELS[rotation]}` });
    });
  });

  labels.push({ at: { x: 0, y: 25.5 }, text: 'Placement ghosts', title: true });

  GHOST_KINDS.forEach((kind, row) => {
    const y = GHOSTS_ORIGIN.y + row * GHOSTS_PITCH_Y;
    labels.push({
      at: { x: GHOSTS_ORIGIN.x, y: y - 0.3 },
      text: `${kind}: ${GHOST_LABELS.join(' · ')}`,
    });
    GHOSTS.forEach((ghost, column) => {
      const x = GHOSTS_ORIGIN.x + column * GHOSTS_PITCH_X;
      items.push({ piece: { id: id(), kind, origin: { x, y }, rotation: 0 }, ghost });
    });
  });

  labels.push({ at: { x: 0, y: 36.5 }, text: 'Connected samples', title: true });

  for (const piece of ovalLayout().pieces) {
    items.push({ piece: translate(piece, OVAL_AT.x, OVAL_AT.y) });
  }
  labels.push({ at: { x: OVAL_AT.x, y: OVAL_AT.y - 0.4 }, text: 'Oval with a station' });

  for (const piece of figureEightLayout().pieces) {
    items.push({ piece: translate(piece, FIGURE_EIGHT_AT.x, FIGURE_EIGHT_AT.y) });
  }
  labels.push({
    at: { x: FIGURE_EIGHT_AT.x, y: FIGURE_EIGHT_AT.y - 0.4 },
    text: 'Figure-eight through a crossing',
  });

  return { items, labels };
}

const scene = buildScene();
const canvas = document.querySelector<HTMLCanvasElement>('#gallery-canvas');
const zoomInput = document.querySelector<HTMLInputElement>('#zoom');
const zoomValue = document.querySelector<HTMLOutputElement>('#zoom-value');
const gridToggle = document.querySelector<HTMLInputElement>('#grid-toggle');
const stage = document.querySelector<HTMLElement>('#gallery-stage');

let scale = Number(zoomInput?.value) || 36;
let showGrid = gridToggle?.checked ?? true;
let frames = 0;
let pan: Point = { x: 0, y: 0 };

function clampScale(value: number): number {
  return Math.min(120, Math.max(20, value));
}

function drawWorldGrid(ctx: CanvasRenderingContext2D): void {
  const x0 = Math.floor(WORLD_MIN.x);
  const x1 = Math.ceil(WORLD_MAX.x);
  const y0 = Math.floor(WORLD_MIN.y);
  const y1 = Math.ceil(WORLD_MAX.y);

  // One device-independent pixel of line, whatever the zoom.
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 1) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1; y += 1) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();

  ctx.strokeStyle = GRID_MAJOR;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / 4) * 4; x <= x1; x += 4) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = Math.ceil(y0 / 4) * 4; y <= y1; y += 4) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: GalleryLabel,
  panX: number,
  panY: number,
): void {
  const size = label.title
    ? Math.max(15, Math.round(scale * 0.5))
    : Math.max(10, Math.round(scale * 0.28));
  ctx.font = `${label.title ? 700 : 500} ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.fillStyle = label.title ? TITLE : INK;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label.text, label.at.x * scale + panX, label.at.y * scale + panY);
}

function render(): void {
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, stage?.clientWidth ?? canvas.clientWidth ?? window.innerWidth);
  const cssHeight = Math.ceil((WORLD_MAX.y + 0.6) * scale);
  canvas.style.height = `${cssHeight}px`;

  const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
  const backingHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const panX =
    (cssWidth - (WORLD_MAX.x - WORLD_MIN.x) * scale) / 2 - WORLD_MIN.x * scale;
  const panY = TOP_PAD * scale - WORLD_MIN.y * scale;
  pan = { x: panX, y: panY };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.save();
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY);
  ctx.fillStyle = GRASS;
  ctx.fillRect(
    WORLD_MIN.x - 1,
    WORLD_MIN.y - 1,
    WORLD_MAX.x - WORLD_MIN.x + 2,
    WORLD_MAX.y - WORLD_MIN.y + 2,
  );
  if (showGrid) drawWorldGrid(ctx);
  for (const item of scene.items) {
    drawPiece(ctx, item.piece, item.ghost ? { ghost: item.ghost } : {});
  }
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const label of scene.labels) drawLabel(ctx, label, panX, panY);

  frames += 1;
}

function setScale(value: number): void {
  scale = clampScale(value);
  if (zoomInput) zoomInput.value = String(scale);
  if (zoomValue) zoomValue.textContent = `${Math.round(scale)} px/cell`;
  render();
}

zoomInput?.addEventListener('input', () => setScale(Number(zoomInput.value)));
gridToggle?.addEventListener('change', () => {
  showGrid = gridToggle.checked;
  render();
});

window.addEventListener('resize', render);
if (typeof ResizeObserver !== 'undefined' && stage) {
  new ResizeObserver(() => render()).observe(stage);
}

setScale(scale);

const handles = debugHandles();
if (handles) {
  handles.gallery = {
    get scale() {
      return scale;
    },
    get frames() {
      return frames;
    },
    get pieces() {
      return scene.items.length;
    },
    setScale,
    redraw: render,
    worldToScreen(point: Point): Point {
      return { x: point.x * scale + pan.x, y: point.y * scale + pan.y };
    },
  };
}
