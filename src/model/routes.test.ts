import { describe, expect, it } from 'vitest';
import { opposite, rotateDef, step, worldConnectors } from './pieces';
import { closedLoops, findRoutes, hasClosedLoop, primaryLoop } from './routes';
import type { Layout, PieceKind, PlacedPiece, Rotation, Route } from './types';

const p = (
  id: string,
  kind: PieceKind,
  x: number,
  y: number,
  rotation: Rotation,
): PlacedPiece => ({ id, kind, origin: { x, y }, rotation });

const layout = (pieces: PlacedPiece[], cols = 32, rows = 24): Layout => ({
  cols,
  rows,
  pieces,
});

// --- Layout fixtures -------------------------------------------------------

/** A 2x2 circle: four sharp curves around the grid point (1, 1). */
const sharpCircle = (prefix = '', x = 0, y = 0): PlacedPiece[] => [
  p(`${prefix}1`, 'curve-sharp', x, y, 0),
  p(`${prefix}2`, 'curve-sharp', x + 1, y, 1),
  p(`${prefix}3`, 'curve-sharp', x + 1, y + 1, 2),
  p(`${prefix}4`, 'curve-sharp', x, y + 1, 3),
];

/** A rounded rectangle that carries a bridge and a tunnel along the top. */
const bridgeTunnelLoop = (prefix = '', x = 0, y = 0): PlacedPiece[] => [
  p(`${prefix}1`, 'curve-sharp', x, y, 0),
  p(`${prefix}2`, 'bridge', x + 1, y, 1),
  p(`${prefix}3`, 'tunnel', x + 2, y, 1),
  p(`${prefix}4`, 'curve-sharp', x + 3, y, 1),
  p(`${prefix}5`, 'curve-sharp', x + 3, y + 1, 2),
  p(`${prefix}6`, 'straight', x + 2, y + 1, 1),
  p(`${prefix}7`, 'straight', x + 1, y + 1, 1),
  p(`${prefix}8`, 'curve-sharp', x, y + 1, 3),
];

/**
 * An oval of straights and gentle curves with a station on the top straight.
 * Gentle curves are quarter turns of radius 1.5, so the two long sides sit
 * three units apart and the corners meet directly on the short sides.
 */
const oval = (): PlacedPiece[] => [
  p('p1', 'curve-gentle', 0, 0, 0), // top-left corner
  p('p2', 'station', 2, 0, 1), // two cells of top straight
  p('p3', 'straight', 4, 0, 1),
  p('p4', 'curve-gentle', 5, 0, 1), // top-right corner
  p('p5', 'curve-gentle', 5, 2, 2), // bottom-right corner
  p('p6', 'straight', 4, 3, 1),
  p('p7', 'straight', 3, 3, 1),
  p('p8', 'straight', 2, 3, 1),
  p('p9', 'curve-gentle', 0, 2, 3), // bottom-left corner
];

/**
 * A figure-eight: the track leaves the crossing on the south, loops back to the
 * east side, crosses, then loops from the west back to the north. The single
 * closed route passes the crossing twice.
 */
const figureEight = (): PlacedPiece[] => [
  p('cross', 'crossing', 0, 0, 0),
  p('a1', 'curve-sharp', 0, 1, 3),
  p('a2', 'curve-sharp', 1, 1, 2),
  p('a3', 'curve-sharp', 1, 0, 1),
  p('b1', 'curve-sharp', -1, 0, 3),
  p('b2', 'curve-sharp', -1, -1, 0),
  p('b3', 'curve-sharp', 0, -1, 1),
];

/** Two buffer stops capping a short vertical line of two straights. */
const bufferLine = (): PlacedPiece[] => [
  p('top', 'buffer-stop', 0, 0, 0),
  p('s1', 'straight', 0, 1, 0),
  p('s2', 'straight', 0, 2, 0),
  p('bottom', 'buffer-stop', 0, 3, 2),
];

// --- Invariant helpers -----------------------------------------------------

/** Every link of every piece, once, in canonical `pieceId:lo-hi` form. */
function expectedLinks(l: Layout): string[] {
  const keys: string[] = [];
  for (const piece of l.pieces) {
    for (const [a, b] of rotateDef(piece.kind, piece.rotation).links) {
      keys.push(`${piece.id}:${Math.min(a, b)}-${Math.max(a, b)}`);
    }
  }
  return keys.sort();
}

/** The links actually walked by `routes`, in canonical form. */
function walkedLinks(routes: Route[]): string[] {
  const keys: string[] = [];
  for (const route of routes) {
    for (const step of route.steps) {
      keys.push(
        `${step.pieceId}:${Math.min(step.from, step.to)}-${Math.max(step.from, step.to)}`,
      );
    }
  }
  return keys.sort();
}

function connectorLookup(l: Layout): Map<string, { pieceId: string; connector: number }> {
  const map = new Map<string, { pieceId: string; connector: number }>();
  for (const piece of l.pieces) {
    worldConnectors(piece).forEach((connector, index) => {
      map.set(
        `${connector.cell.x},${connector.cell.y},${connector.dir}`,
        { pieceId: piece.id, connector: index },
      );
    });
  }
  return map;
}

function pieceById(l: Layout, id: string): PlacedPiece {
  const piece = l.pieces.find((candidate) => candidate.id === id);
  if (!piece) throw new Error(`missing piece ${id}`);
  return piece;
}

/** Asserts the walk invariants that hold for every route. */
function assertConsistent(l: Layout, route: Route): void {
  expect(route.steps.length).toBeGreaterThan(0);
  const lookup = connectorLookup(l);

  route.steps.forEach((stepInfo, index) => {
    const piece = pieceById(l, stepInfo.pieceId);
    const def = rotateDef(piece.kind, piece.rotation);

    // `from` and `to` are the two ends of one real link of the piece.
    const isLinked = def.links.some(
      ([a, b]) =>
        (a === stepInfo.from && b === stepInfo.to) ||
        (a === stepInfo.to && b === stepInfo.from),
    );
    expect(isLinked).toBe(true);

    const connectors = worldConnectors(piece);
    const exit = connectors[stepInfo.to];
    const neighbor = step(exit.cell, exit.dir);
    const joined = lookup.get(
      `${neighbor.x},${neighbor.y},${opposite(exit.dir)}`,
    );

    if (index < route.steps.length - 1) {
      // Each step's `to` joins the next step's `from`.
      expect(joined?.pieceId).toBe(route.steps[index + 1].pieceId);
      expect(joined?.connector).toBe(route.steps[index + 1].from);
    } else if (route.closed) {
      // The last step joins back to the first.
      expect(joined?.pieceId).toBe(route.steps[0].pieceId);
      expect(joined?.connector).toBe(route.steps[0].from);
    } else {
      // An open route ends at an open connector or a buffer stop (no link).
      const tail = joined ? pieceById(l, joined.pieceId) : null;
      const isBuffer =
        tail !== null &&
        rotateDef(tail.kind, tail.rotation).links.length === 0;
      expect(joined === undefined || isBuffer).toBe(true);
    }
  });
}

function assertAllConsistent(l: Layout): Route[] {
  const routes = findRoutes(l);
  for (const route of routes) assertConsistent(l, route);

  // Every link is covered exactly once, and never twice.
  const walked = walkedLinks(routes);
  expect(walked).toEqual(expectedLinks(l));
  expect(new Set(walked).size).toBe(walked.length);
  return routes;
}

// --- Tests -----------------------------------------------------------------

describe('findRoutes / closedLoops / hasClosedLoop', () => {
  it('walks a 2x2 circle of four sharp curves as one closed route', () => {
    const l = layout(sharpCircle('p'));
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(true);
    expect(routes[0].steps).toHaveLength(4);
    expect(routes[0].steps[0].pieceId).toBe('p1'); // lowest id
    expect(hasClosedLoop(l)).toBe(true);
    expect(closedLoops(l)).toHaveLength(1);
  });

  it('walks an oval of straights and gentle curves with a station', () => {
    const l = layout(oval());
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(true);
    expect(routes[0].steps).toHaveLength(9);
    expect(routes[0].steps.map((s) => s.pieceId)).toContain('p2'); // station
    expect(hasClosedLoop(l)).toBe(true);
  });

  it('walks a figure-eight as one closed route through the crossing twice', () => {
    const l = layout(figureEight());
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(true);
    expect(routes[0].steps).toHaveLength(8);

    const crossingSteps = routes[0].steps
      .filter((s) => s.pieceId === 'cross')
      .map((s) => [s.from, s.to]);
    expect(crossingSteps).toHaveLength(2);
    // One pass uses the north/south link, the other the east/west link.
    expect(crossingSteps.sort((a, b) => a[0] - b[0])).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('reports an open line between two buffer stops as not closed', () => {
    const l = layout(bufferLine());
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(false);
    expect(routes[0].steps).toHaveLength(2);
    expect(hasClosedLoop(l)).toBe(false);
    expect(closedLoops(l)).toHaveLength(0);
    expect(primaryLoop(l)).toBeNull();
  });

  it('reports a loop with one piece removed as not closed', () => {
    const l = layout(sharpCircle('p').filter((piece) => piece.id !== 'p1'));
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(false);
    expect(routes[0].steps).toHaveLength(3);
    expect(hasClosedLoop(l)).toBe(false);
  });

  it('walks a loop that contains a bridge and a tunnel', () => {
    const l = layout(bridgeTunnelLoop());
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(1);
    expect(routes[0].closed).toBe(true);
    expect(routes[0].steps).toHaveLength(8);
    const kinds = routes[0].steps.map(
      (s) => pieceById(l, s.pieceId).kind,
    );
    expect(kinds).toContain('bridge');
    expect(kinds).toContain('tunnel');
  });

  it('finds two separate loops', () => {
    const l = layout([
      ...sharpCircle('a', 0, 0),
      ...bridgeTunnelLoop('b', 20, 0),
    ]);
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.closed)).toBe(true);
    expect(routes.map((route) => route.steps.length).sort()).toEqual([4, 8]);
  });
});

describe('primaryLoop', () => {
  it('picks the longer of two separate loops', () => {
    const l = layout([
      ...sharpCircle('a', 0, 0), // 4 steps
      ...bridgeTunnelLoop('b', 20, 0), // 8 steps
    ]);
    const primary = primaryLoop(l);

    expect(primary).not.toBeNull();
    expect(primary?.steps).toHaveLength(8);
    expect(primary?.steps.map((s) => s.pieceId)).toContain('b2'); // bridge
  });

  it('breaks a tie by the route containing the lowest piece id', () => {
    const l = layout([
      ...sharpCircle('a', 0, 0),
      ...sharpCircle('b', 20, 0),
    ]);
    const primary = primaryLoop(l);

    expect(primary?.steps).toHaveLength(4);
    expect(primary?.steps[0].pieceId).toBe('a1');
  });

  it('is null when there is no closed loop', () => {
    expect(primaryLoop(layout(bufferLine()))).toBeNull();
    expect(primaryLoop(layout(sharpCircle().slice(1)))).toBeNull();
  });
});

describe('findRoutes performance', () => {
  it('handles a 1,000-piece layout in under 10 ms', () => {
    const pieces: PlacedPiece[] = [];
    for (let i = 0; i < 250; i += 1) {
      const x = (i % 25) * 4;
      const y = Math.floor(i / 25) * 4;
      pieces.push(...sharpCircle(`t${i}_`, x, y));
    }
    expect(pieces).toHaveLength(1000);

    // Warm the JIT with a throwaway layout first: timing the very first call
    // measured first-call compilation and allocation, which pushed a shared CI
    // runner just over the 10 ms budget even though warm runs take ~1-3 ms.
    findRoutes(layout(sharpCircle('warmup_')));

    // Time the best of a few runs, each with a fresh layout object so the index
    // is rebuilt every time. Taking the fastest run keeps the 10 ms budget
    // meaningful while absorbing a stray scheduling hiccup on a busy runner.
    const runs: number[] = [];
    let routes: Route[] = [];
    for (let i = 0; i < 5; i += 1) {
      const l: Layout = { cols: 200, rows: 100, pieces };
      const start = performance.now();
      routes = findRoutes(l);
      runs.push(performance.now() - start);
    }
    const elapsed = Math.min(...runs);

    expect(routes).toHaveLength(250);
    expect(routes.every((route) => route.closed && route.steps.length === 4)).toBe(true);
    expect(elapsed).toBeLessThan(10);
  });

  it('still finds routes when the pieces are spread far apart', () => {
    // A bounding box this large must not force a giant lookup table.
    const l = layout([
      ...sharpCircle('a', 0, 0),
      ...sharpCircle('b', 2_000_000, 0),
    ]);
    const routes = assertAllConsistent(l);

    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.closed)).toBe(true);
  });
});
