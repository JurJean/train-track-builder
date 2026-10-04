import { describe, expect, it } from 'vitest';
import { routePath } from '../model/geometry';
import { hasClosedLoop, primaryLoop } from '../model/routes';
import { demoOvalLayout, figureEightLayout, ovalLayout } from './samples';

describe('sample layouts', () => {
  it('closes the gallery oval as before', () => {
    expect(hasClosedLoop(ovalLayout())).toBe(true);
    expect(primaryLoop(ovalLayout())?.steps).toHaveLength(11);
  });

  it('closes the figure-eight', () => {
    expect(hasClosedLoop(figureEightLayout())).toBe(true);
  });
});

describe('demoOvalLayout', () => {
  it('is one closed loop with a station, a bridge and a tunnel', () => {
    const layout = demoOvalLayout();

    expect(hasClosedLoop(layout)).toBe(true);
    const loop = primaryLoop(layout);
    expect(loop).not.toBeNull();
    expect(loop?.closed).toBe(true);

    const kinds = new Set(layout.pieces.map((piece) => piece.kind));
    expect(kinds).toContain('station');
    expect(kinds).toContain('bridge');
    expect(kinds).toContain('tunnel');

    // The whole loop is walkable, with a positive length.
    const path = routePath(layout, loop!);
    expect(path.closed).toBe(true);
    expect(path.length).toBeGreaterThan(4);
  });

  it('places the demo in the middle of the grid, in bounds', () => {
    const layout = demoOvalLayout();
    for (const piece of layout.pieces) {
      expect(piece.origin.x).toBeGreaterThanOrEqual(0);
      expect(piece.origin.y).toBeGreaterThanOrEqual(0);
      expect(piece.origin.x).toBeLessThan(layout.cols);
      expect(piece.origin.y).toBeLessThan(layout.rows);
    }
  });
});
