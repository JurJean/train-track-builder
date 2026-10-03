import { describe, expect, it } from 'vitest';
import { routePath, stepSegment } from './geometry';
import { PIECES, connectorPoint, worldConnectors } from './pieces';
import { findRoutes } from './routes';
import type {
  Layout,
  PathSegment,
  PieceKind,
  PlacedPiece,
  Pose,
  Rotation,
  Route,
  RouteStep,
} from './types';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

/** Every kind that actually carries a track link. */
const LINK_KINDS: PieceKind[] = [
  'straight',
  'bridge',
  'tunnel',
  'curve-sharp',
  'curve-gentle',
  'crossing',
  'station',
];

/** The length the issue specifies for each kind's links. */
const EXPECTED_LENGTHS: Record<PieceKind, number[]> = {
  straight: [1],
  bridge: [1],
  tunnel: [1],
  station: [2],
  'curve-sharp': [Math.PI / 4],
  'curve-gentle': [(3 * Math.PI) / 4],
  crossing: [1, 1],
  'buffer-stop': [],
};

const EPS = 1e-9;

function angleDelta(a: number, b: number): number {
  let delta = (a - b) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function expectClose(actual: number, expected: number, eps = EPS): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
}

function expectPose(actual: Pose, expected: Pose, eps = EPS): void {
  expectClose(actual.x, expected.x, eps);
  expectClose(actual.y, expected.y, eps);
  expectClose(angleDelta(actual.heading, expected.heading), 0, eps);
}

function expectPosition(actual: Pose, expected: Pose, eps = EPS): void {
  expectClose(actual.x, expected.x, eps);
  expectClose(actual.y, expected.y, eps);
}

function placed(kind: PieceKind, rotation: Rotation): PlacedPiece {
  return { id: 'p', kind, origin: { x: 3, y: 5 }, rotation };
}

describe('stepSegment endpoints and headings', () => {
  for (const kind of LINK_KINDS) {
    for (const rotation of ROTATIONS) {
      it(`spans and points along the track for ${kind} r${rotation}`, () => {
        const piece = placed(kind, rotation);
        const connectors = worldConnectors(piece);
        const links = PIECES[kind].links;

        links.forEach(([from, to], index) => {
          const start = connectorPoint(connectors[from]);
          const end = connectorPoint(connectors[to]);
          const segment = stepSegment(piece, from, to);

          expectClose(segment.length, EXPECTED_LENGTHS[kind][index]);

          const atStart = segment.poseAt(0);
          const atEnd = segment.poseAt(segment.length);
          expectClose(atStart.x, start.x);
          expectClose(atStart.y, start.y);
          expectClose(atEnd.x, end.x);
          expectClose(atEnd.y, end.y);

          // Independently of the analytic heading, a tiny step must point the
          // way the track runs.
          const delta = segment.length * 1e-4;
          const ahead = segment.poseAt(delta);
          const startHeading = Math.atan2(ahead.y - atStart.y, ahead.x - atStart.x);
          expectClose(angleDelta(atStart.heading, startHeading), 0, 1e-3);

          const behind = segment.poseAt(segment.length - delta);
          const endHeading = Math.atan2(atEnd.y - behind.y, atEnd.x - behind.x);
          expectClose(angleDelta(atEnd.heading, endHeading), 0, 1e-3);
        });
      });
    }
  }

  it('has no track link on a buffer stop', () => {
    expect(() => stepSegment(placed('buffer-stop', 0), 0, 1)).toThrow();
  });
});

describe('stepSegment reversal', () => {
  for (const kind of LINK_KINDS) {
    for (const rotation of ROTATIONS) {
      it(`reverses ${kind} r${rotation}`, () => {
        const piece = placed(kind, rotation);
        for (const [from, to] of PIECES[kind].links) {
          const forward = stepSegment(piece, from, to);
          const backward = stepSegment(piece, to, from);

          expectClose(backward.length, forward.length, 1e-12);

          for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const f = forward.poseAt(forward.length * fraction);
            const b = backward.poseAt(backward.length * (1 - fraction));
            expectPosition(b, f);
            // Travelling the other way flips the heading.
            expectClose(angleDelta(b.heading, f.heading + Math.PI), 0);
          }
        }
      });
    }
  }
});

// --- layout fixtures -------------------------------------------------------

const piece = (
  id: string,
  kind: PieceKind,
  x: number,
  y: number,
  rotation: Rotation,
): PlacedPiece => ({ id, kind, origin: { x, y }, rotation });

const layoutOf = (pieces: PlacedPiece[]): Layout => ({ cols: 32, rows: 24, pieces });

/** A one-cell closed loop of four sharp curves, the 2×2 circle. */
const circleLayout = (): Layout =>
  layoutOf([
    piece('p1', 'curve-sharp', 0, 0, 0),
    piece('p2', 'curve-sharp', 1, 0, 1),
    piece('p3', 'curve-sharp', 1, 1, 2),
    piece('p4', 'curve-sharp', 0, 1, 3),
  ]);

/** An oval of straights and gentle curves with a station on the top straight. */
const ovalLayout = (): Layout =>
  layoutOf([
    piece('p1', 'curve-gentle', 0, 0, 0),
    piece('p2', 'station', 2, 0, 1),
    piece('p3', 'straight', 4, 0, 1),
    piece('p4', 'curve-gentle', 5, 0, 1),
    piece('p5', 'curve-gentle', 5, 2, 2),
    piece('p6', 'straight', 4, 3, 1),
    piece('p7', 'straight', 3, 3, 1),
    piece('p8', 'straight', 2, 3, 1),
    piece('p9', 'curve-gentle', 0, 2, 3),
  ]);

/** A figure-eight whose single closed route crosses the middle twice. */
const figureEightLayout = (): Layout =>
  layoutOf([
    piece('cross', 'crossing', 0, 0, 0),
    piece('a1', 'curve-sharp', 0, 1, 3),
    piece('a2', 'curve-sharp', 1, 1, 2),
    piece('a3', 'curve-sharp', 1, 0, 1),
    piece('b1', 'curve-sharp', -1, 0, 3),
    piece('b2', 'curve-sharp', -1, -1, 0),
    piece('b3', 'curve-sharp', 0, -1, 1),
  ]);

function segmentsOf(layout: Layout, route: Route): PathSegment[] {
  const byId = new Map(layout.pieces.map((entry) => [entry.id, entry] as const));
  return route.steps.map((step) => {
    const found = byId.get(step.pieceId);
    if (!found) throw new Error(`missing piece ${step.pieceId}`);
    return stepSegment(found, step.from, step.to);
  });
}

function expectContinuous(layout: Layout, route: Route): void {
  const segments = segmentsOf(layout, route);
  const count = segments.length;
  const joins = route.closed ? count : count - 1;

  for (let i = 0; i < joins; i += 1) {
    const end = segments[i];
    const start = segments[(i + 1) % count];
    expectPose(end.poseAt(end.length), start.poseAt(0));
  }

  // The composed path agrees with the segments at every join.
  const path = routePath(layout, route);
  let cumulative = 0;
  for (let i = 0; i < count; i += 1) {
    cumulative += segments[i].length;
    expectPose(path.poseAt(cumulative), segments[i].poseAt(segments[i].length));
  }
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  expect(path.length).toBeCloseTo(total, 12);
}

/** The single closed loop the route finder reports for a layout. */
function closedLoopOf(layout: Layout): Route {
  const closed = findRoutes(layout).filter((route) => route.closed);
  expect(closed).toHaveLength(1);
  return closed[0];
}

describe('routePath continuity', () => {
  it('meets itself on an oval', () => {
    const layout = ovalLayout();
    expectContinuous(layout, closedLoopOf(layout));
  });

  it('meets itself on a 2×2 circle', () => {
    const layout = circleLayout();
    expectContinuous(layout, closedLoopOf(layout));
  });

  it('meets itself on a figure-eight', () => {
    const layout = figureEightLayout();
    expectContinuous(layout, closedLoopOf(layout));
  });

  it('follows routes from the route finder, not just hand-built ones', () => {
    for (const build of [ovalLayout, circleLayout, figureEightLayout]) {
      const layout = build();
      for (const route of findRoutes(layout)) {
        if (route.closed) expectContinuous(layout, route);
      }
    }
  });
});

describe('routePath wrapping and clamping', () => {
  it('wraps a closed route modulo its length, including negative s', () => {
    const layout = circleLayout();
    const path = routePath(layout, closedLoopOf(layout));
    for (const s of [0, 0.2, 1.1, path.length - 0.05]) {
      expectPose(path.poseAt(s), path.poseAt(s + path.length));
      expectPose(path.poseAt(s), path.poseAt(s - path.length));
      expectPose(path.poseAt(s), path.poseAt(s + 5 * path.length));
      expectPose(path.poseAt(s), path.poseAt(s - 5 * path.length));
    }
  });

  it('clamps an open route to its endpoints', () => {
    const layout = layoutOf([
      piece('s1', 'straight', 0, 0, 0),
      piece('s2', 'straight', 0, 1, 0),
    ]);
    const steps: RouteStep[] = [
      { pieceId: 's1', from: 0, to: 1 },
      { pieceId: 's2', from: 0, to: 1 },
    ];
    const path = routePath(layout, { steps, closed: false });

    expect(path.length).toBeCloseTo(2, 12);
    expectPose(path.poseAt(-5), path.poseAt(0));
    expectPose(path.poseAt(9), path.poseAt(2));
    expectPose(path.poseAt(1.5), { x: 0.5, y: 1.5, heading: Math.PI / 2 });
  });
});

describe('routePath performance', () => {
  function longRoute(n: number): { layout: Layout; route: Route } {
    const pieces: PlacedPiece[] = [];
    const steps: RouteStep[] = [];
    for (let i = 0; i < n; i += 1) {
      pieces.push({ id: `p${i + 1}`, kind: 'straight', origin: { x: 0, y: i }, rotation: 0 });
      steps.push({ pieceId: `p${i + 1}`, from: 0, to: 1 });
    }
    return { layout: { cols: 1, rows: n, pieces }, route: { steps, closed: false } };
  }

  it('resolves a pose in a 65,536-segment route with O(log n) work', () => {
    const n = 65_536;
    const { layout, route } = longRoute(n);
    const path = routePath(layout, route);

    // A linear scan would walk the whole route to reach the far end.
    const far = path.poseAt(n - 0.5);
    expectClose(far.x, 0.5);
    expectClose(far.y, n - 0.5);
    expectClose(angleDelta(far.heading, Math.PI / 2), 0);

    const iterations = 100_000;
    const start = performance.now();
    let accumulator = 0;
    for (let i = 0; i < iterations; i += 1) {
      accumulator += path.poseAt((i * 7919) % n).y;
    }
    const average = (performance.now() - start) / iterations;

    expect(accumulator).toBeGreaterThan(0);
    expect(average).toBeLessThan(0.01);
  });
});
