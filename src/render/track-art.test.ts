import { describe, expect, it } from 'vitest';
import { connectionsOf, openEnds } from '../model/layout';
import { PIECES, linkShapes, rotateDef } from '../model/pieces';
import type { LinkShape, PieceKind, PlacedPiece, Point, Rotation } from '../model/types';
import { figureEightLayout, ovalLayout } from './samples';
import {
  CACHE_BUCKETS,
  RAIL_GAUGE,
  cacheBucket,
  railPoints,
  rotateBasePoint,
  sampleShape,
} from './track-art';

const KINDS: PieceKind[] = [
  'straight',
  'curve-gentle',
  'curve-sharp',
  'crossing',
  'bridge',
  'tunnel',
  'station',
  'buffer-stop',
];

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe('cacheBucket', () => {
  it('is monotonic, bounded and snaps to the nearest bucket at or above', () => {
    expect(cacheBucket(1)).toBe(CACHE_BUCKETS[0]);
    expect(cacheBucket(CACHE_BUCKETS[0])).toBe(CACHE_BUCKETS[0]);
    expect(cacheBucket(17)).toBe(20);
    expect(cacheBucket(10_000)).toBe(CACHE_BUCKETS[CACHE_BUCKETS.length - 1]);

    let previous = 0;
    for (let scale = 0; scale < 300; scale += 1) {
      const bucket = cacheBucket(scale);
      expect(bucket).toBeGreaterThanOrEqual(previous);
      previous = bucket;
    }
  });
});

describe('rotateBasePoint', () => {
  it('maps base link shapes onto rotateDef exactly', () => {
    for (const kind of KINDS) {
      const base = PIECES[kind].shapes;
      for (const rotation of ROTATIONS) {
        const rotated = rotateDef(kind, rotation).shapes;
        expect(rotated).toHaveLength(base.length);
        base.forEach((shape, index) => {
          const target = rotated[index];
          expectPointClose(rotateBasePoint(kind, rotation, shape.a), target.a);
          expectPointClose(rotateBasePoint(kind, rotation, shape.b), target.b);
          if (shape.type === 'arc' && target.type === 'arc') {
            expectPointClose(rotateBasePoint(kind, rotation, shape.center), target.center);
            expect(target.radius).toBeCloseTo(shape.radius, 10);
          }
        });
      }
    }
  });
});

describe('railPoints', () => {
  it('sits one gauge away from the centreline on both sides', () => {
    for (const kind of KINDS) {
      for (const rotation of ROTATIONS) {
        for (const shape of rotateDef(kind, rotation).shapes) {
          const start = sampleShape(shape, 0).point;
          const outer = railPoints(shape, RAIL_GAUGE).atA;
          const inner = railPoints(shape, -RAIL_GAUGE).atA;
          expect(Math.hypot(outer.x - start.x, outer.y - start.y)).toBeCloseTo(
            RAIL_GAUGE,
            10,
          );
          expect(Math.hypot(inner.x - start.x, inner.y - start.y)).toBeCloseTo(
            RAIL_GAUGE,
            10,
          );
        }
      }
    }
  });
});

function sameRailSet(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((point) =>
    b.some(
      (other) =>
        Math.abs(point.x - other.x) < 1e-9 && Math.abs(point.y - other.y) < 1e-9,
    ),
  );
}

function railPointAt(piece: PlacedPiece, connector: number, offset: number): Point | null {
  const def = rotateDef(piece.kind, piece.rotation);
  const shapes = linkShapes(piece);
  for (let i = 0; i < def.links.length; i += 1) {
    const [from, to] = def.links[i];
    const pair = railPoints(shapes[i], offset);
    if (from === connector) return pair.atA;
    if (to === connector) return pair.atB;
  }
  return null;
}

function railSetAt(piece: PlacedPiece, connector: number): Point[] {
  const rails: Point[] = [];
  for (const offset of [RAIL_GAUGE, -RAIL_GAUGE]) {
    const point = railPointAt(piece, connector, offset);
    if (point) rails.push(point);
  }
  return rails;
}

function expectRailJoins(layout: ReturnType<typeof ovalLayout>): void {
  const byId = new Map(layout.pieces.map((piece) => [piece.id, piece]));
  let joins = 0;

  for (const piece of layout.pieces) {
    const connections = connectionsOf(layout, piece.id);
    connections.forEach((connection, connector) => {
      if (!connection) return;
      const neighbour = byId.get(connection.pieceId);
      if (!neighbour) throw new Error('connection points at a missing piece');
      const mine = railSetAt(piece, connector);
      const theirs = railSetAt(neighbour, connection.connector);
      expect(mine.length).toBeGreaterThan(0);
      expect(sameRailSet(mine, theirs)).toBe(true);
      joins += 1;
    });
  }

  expect(joins).toBeGreaterThan(0);
  expect(openEnds(layout)).toEqual([]);
}

describe('sample layouts', () => {
  it('builds a closed oval with a station and matching rail joins', () => {
    const layout = ovalLayout();
    expect(layout.pieces.filter((piece) => piece.kind === 'station')).toHaveLength(1);
    expectRailJoins(layout);
  });

  it('builds a closed figure-eight through a crossing with matching rail joins', () => {
    const layout = figureEightLayout();
    expect(layout.pieces.filter((piece) => piece.kind === 'crossing')).toHaveLength(1);
    expectRailJoins(layout);
  });
});

describe('sampleShape', () => {
  it('starts and ends on the link endpoints', () => {
    const shapes: LinkShape[] = [];
    for (const kind of KINDS) {
      shapes.push(...(PIECES[kind].shapes as LinkShape[]));
    }
    for (const shape of shapes) {
      expectPointClose(sampleShape(shape, 0).point, shape.a);
      expectPointClose(sampleShape(shape, 1).point, shape.b);
    }
  });

  it('puts a tunnel portal at each end of its link shape at every rotation', () => {
    for (const rotation of ROTATIONS) {
      const shape = rotateDef('tunnel', rotation).shapes[0];
      expect(shape.type).toBe('line');
      const start = sampleShape(shape, 0).point;
      const end = sampleShape(shape, 1).point;
      // Rails only survive where these portal mouths overlap the link shape, so
      // the two portal centres must sit exactly on the two connector points.
      expectPointClose(start, shape.a);
      expectPointClose(end, shape.b);
    }
  });
});
