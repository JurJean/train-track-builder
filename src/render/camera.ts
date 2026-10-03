import type { Cell, Point } from '../model/types';

/** Smallest zoom: 20 CSS pixels per grid cell. */
export const MIN_SCALE = 20;
/** Largest zoom: 120 CSS pixels per grid cell. */
export const MAX_SCALE = 120;
/** Zoom used before a viewport is available to fit the grid. */
export const DEFAULT_SCALE = 40;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Camera state for the board.
 *
 * `x`/`y` are the screen position (CSS pixels, board-relative, origin at the
 * board's top-left) of the world origin and `scale` is the number of CSS pixels
 * per cell. World units are grid cells, so the world point (1, 2) is the corner
 * shared by cells (0, 1), (1, 1), (0, 2) and (1, 2).
 */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function createCamera(scale: number = DEFAULT_SCALE): Camera {
  return { x: 0, y: 0, scale: clamp(scale, MIN_SCALE, MAX_SCALE) };
}

/** Screen position (CSS px, board-relative) of a world point. */
export function toScreen(camera: Camera, world: Point): Point {
  return {
    x: world.x * camera.scale + camera.x,
    y: world.y * camera.scale + camera.y,
  };
}

/** World point under a board-relative screen position. */
export function toWorld(camera: Camera, screen: Point): Point {
  return {
    x: (screen.x - camera.x) / camera.scale,
    y: (screen.y - camera.y) / camera.scale,
  };
}

/** Cell that contains a board-relative screen position. */
export function screenToCell(camera: Camera, screen: Point): Cell {
  const world = toWorld(camera, screen);
  return { x: Math.floor(world.x), y: Math.floor(world.y) };
}

/** Board-relative screen position of the centre of a cell. */
export function cellToScreen(camera: Camera, cell: Cell): Point {
  return toScreen(camera, { x: cell.x + 0.5, y: cell.y + 0.5 });
}

/** Move the camera by a screen-space delta. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

/**
 * Zoom by `factor` while keeping the world point under `screen` fixed.
 * The resulting scale is clamped to [MIN_SCALE, MAX_SCALE].
 */
export function zoomAt(camera: Camera, screen: Point, factor: number): Camera {
  const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
  const world = toWorld(camera, screen);
  return {
    x: screen.x - world.x * scale,
    y: screen.y - world.y * scale,
    scale,
  };
}

/** Zoom to an absolute scale while keeping the world point under `screen` fixed. */
export function setScaleAt(camera: Camera, screen: Point, scale: number): Camera {
  const target = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (target === camera.scale) return { ...camera };
  return zoomAt(camera, screen, target / camera.scale);
}

/**
 * Fit a `cols` x `rows` grid into the viewport, centred, with a little breathing
 * room (`padding` is a fraction of each viewport side).
 */
export function fit(
  cols: number,
  rows: number,
  viewport: Viewport,
  padding = 0.04,
): Camera {
  const usableWidth = Math.max(1, viewport.width * (1 - padding * 2));
  const usableHeight = Math.max(1, viewport.height * (1 - padding * 2));
  const scale = clamp(
    Math.min(usableWidth / cols, usableHeight / rows),
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    x: (viewport.width - cols * scale) / 2,
    y: (viewport.height - rows * scale) / 2,
  };
}

/**
 * Clamp the zoom to [MIN_SCALE, MAX_SCALE] and keep at least `margin` of the
 * smaller of grid/viewport along each axis on screen, so the grid can never be
 * panned completely out of view.
 */
export function clampCamera(
  camera: Camera,
  viewport: Viewport,
  cols: number,
  rows: number,
  margin = 0.15,
): Camera {
  const scale = clamp(camera.scale, MIN_SCALE, MAX_SCALE);
  const gridWidth = cols * scale;
  const gridHeight = rows * scale;
  const keepX = Math.min(gridWidth, viewport.width) * margin;
  const keepY = Math.min(gridHeight, viewport.height) * margin;
  return {
    scale,
    x: clamp(camera.x, keepX - gridWidth, viewport.width - keepX),
    y: clamp(camera.y, keepY - gridHeight, viewport.height - keepY),
  };
}

/** World-space rectangle currently visible in the viewport. */
export function visibleBounds(
  camera: Camera,
  viewport: Viewport,
): { min: Point; max: Point } {
  return {
    min: toWorld(camera, { x: 0, y: 0 }),
    max: toWorld(camera, { x: viewport.width, y: viewport.height }),
  };
}
