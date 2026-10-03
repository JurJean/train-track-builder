import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  cellToScreen,
  clampCamera,
  createCamera,
  fit,
  panBy,
  screenToCell,
  setScaleAt,
  toScreen,
  toWorld,
  visibleBounds,
  zoomAt,
} from './camera';

describe('toScreen / toWorld', () => {
  it('puts the world origin at the camera offset', () => {
    const camera = { x: 50, y: 80, scale: 40 };
    expect(toScreen(camera, { x: 0, y: 0 })).toEqual({ x: 50, y: 80 });
  });

  it('round-trips a world point through screen space', () => {
    const camera = { x: 123, y: -45, scale: 37.5 };
    const world = { x: 3.25, y: -1.75 };
    const back = toWorld(camera, toScreen(camera, world));
    expect(back.x).toBeCloseTo(world.x, 10);
    expect(back.y).toBeCloseTo(world.y, 10);
  });
});

describe('screenToCell', () => {
  const camera = { x: 0, y: 0, scale: 40 };

  it('floors world coordinates into cells', () => {
    expect(screenToCell(camera, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(screenToCell(camera, { x: 39.9, y: 39.9 })).toEqual({ x: 0, y: 0 });
    expect(screenToCell(camera, { x: 40, y: 80 })).toEqual({ x: 1, y: 2 });
  });

  it('handles negative coordinates', () => {
    expect(screenToCell(camera, { x: -1, y: -41 })).toEqual({ x: -1, y: -2 });
  });

  it('is the inverse of cellToScreen at cell centres', () => {
    const shifted = { x: 13, y: -7, scale: 33 };
    for (const cell of [{ x: 0, y: 0 }, { x: 5, y: 3 }, { x: -2, y: -4 }]) {
      expect(screenToCell(shifted, cellToScreen(shifted, cell))).toEqual(cell);
    }
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const camera = { x: 30, y: 20, scale: 40 };
    const anchor = { x: 210, y: 160 };
    const before = toWorld(camera, anchor);

    const zoomed = zoomAt(camera, anchor, 1.7);
    const after = toWorld(zoomed, anchor);

    expect(zoomed.scale).toBeCloseTo(68, 10);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('clamps the zoom to the allowed range', () => {
    const camera = { x: 0, y: 0, scale: 40 };
    expect(zoomAt(camera, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE);
  });

  it('still fixes the anchor when the zoom is clamped', () => {
    const camera = { x: 12, y: 34, scale: 100 };
    const anchor = { x: 77, y: 55 };
    const before = toWorld(camera, anchor);

    const zoomed = zoomAt(camera, anchor, 10);

    expect(zoomed.scale).toBe(MAX_SCALE);
    expect(toWorld(zoomed, anchor).x).toBeCloseTo(before.x, 10);
    expect(toWorld(zoomed, anchor).y).toBeCloseTo(before.y, 10);
  });
});

describe('setScaleAt', () => {
  it('zooms to an absolute scale around the anchor', () => {
    const camera = { x: 0, y: 0, scale: 40 };
    const anchor = { x: 100, y: 100 };
    const before = toWorld(camera, anchor);

    const zoomed = setScaleAt(camera, anchor, 80);

    expect(zoomed.scale).toBe(80);
    expect(toWorld(zoomed, anchor).x).toBeCloseTo(before.x, 10);
    expect(toWorld(zoomed, anchor).y).toBeCloseTo(before.y, 10);
  });

  it('clamps the target scale', () => {
    const camera = { x: 0, y: 0, scale: 40 };
    expect(setScaleAt(camera, { x: 0, y: 0 }, 0).scale).toBe(MIN_SCALE);
    expect(setScaleAt(camera, { x: 0, y: 0 }, 999).scale).toBe(MAX_SCALE);
  });
});

describe('panBy', () => {
  it('adds the delta in screen space', () => {
    expect(panBy({ x: 5, y: 6, scale: 40 }, -2, 9)).toEqual({
      x: 3,
      y: 15,
      scale: 40,
    });
  });
});

describe('createCamera', () => {
  it('clamps the starting scale', () => {
    expect(createCamera(5).scale).toBe(MIN_SCALE);
    expect(createCamera(500).scale).toBe(MAX_SCALE);
    expect(createCamera(60).scale).toBe(60);
  });
});

describe('fit', () => {
  it('centres and fits the whole grid', () => {
    const camera = fit(32, 24, { width: 800, height: 600 }, 0);

    expect(camera.scale).toBe(25);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(toScreen(camera, { x: 32, y: 24 })).toEqual({ x: 800, y: 600 });
  });

  it('centres the grid with padding', () => {
    const camera = fit(10, 10, { width: 500, height: 500 }, 0.1);
    expect(camera.scale).toBe(40);
    expect(camera.x).toBeCloseTo(50, 10);
    expect(camera.y).toBeCloseTo(50, 10);
  });

  it('clamps to the zoom range for very large grids', () => {
    const camera = fit(1000, 1000, { width: 500, height: 500 }, 0);
    expect(camera.scale).toBe(MIN_SCALE);
    expect(camera.x).toBeCloseTo((500 - 1000 * MIN_SCALE) / 2, 10);
  });
});

describe('clampCamera', () => {
  const viewport = { width: 800, height: 600 };

  it('clamps the zoom range', () => {
    expect(clampCamera({ x: 0, y: 0, scale: 1000 }, viewport, 32, 24).scale).toBe(
      MAX_SCALE,
    );
    expect(clampCamera({ x: 0, y: 0, scale: 0 }, viewport, 32, 24).scale).toBe(
      MIN_SCALE,
    );
  });

  it('leaves a reasonable camera untouched', () => {
    const camera = { x: 100, y: 80, scale: 40 };
    expect(clampCamera(camera, viewport, 32, 24)).toEqual(camera);
  });

  it('keeps part of the grid visible when panned far right and down', () => {
    const clamped = clampCamera({ x: 5000, y: 5000, scale: 40 }, viewport, 32, 24);
    const topLeft = toScreen(clamped, { x: 0, y: 0 });
    const bottomRight = toScreen(clamped, { x: 32, y: 24 });

    expect(topLeft.x).toBeLessThan(viewport.width);
    expect(topLeft.y).toBeLessThan(viewport.height);
    expect(bottomRight.x).toBeGreaterThan(0);
    expect(bottomRight.y).toBeGreaterThan(0);
  });

  it('keeps part of the grid visible when panned far left and up', () => {
    const clamped = clampCamera({ x: -5000, y: -5000, scale: 40 }, viewport, 32, 24);
    const topLeft = toScreen(clamped, { x: 0, y: 0 });
    const bottomRight = toScreen(clamped, { x: 32, y: 24 });

    expect(bottomRight.x).toBeGreaterThan(0);
    expect(bottomRight.y).toBeGreaterThan(0);
    expect(topLeft.x).toBeLessThan(viewport.width);
    expect(topLeft.y).toBeLessThan(viewport.height);
  });
});

describe('visibleBounds', () => {
  it('returns the world rectangle covering the viewport', () => {
    const camera = { x: 10, y: 20, scale: 40 };
    const bounds = visibleBounds(camera, { width: 400, height: 200 });
    expect(bounds.min).toEqual({ x: -0.25, y: -0.5 });
    expect(bounds.max).toEqual({ x: 9.75, y: 4.5 });
  });
});
