import { linkShapes, rotateDef } from './pieces';
import type { Layout, LinkShape, PathSegment, PlacedPiece, Point, Pose, Route } from './types';

/**
 * A whole route resolved into one continuous path in world units.
 *
 * `poseAt` is the hot path (it runs for every car on every frame), so it does a
 * binary search over precomputed cumulative lengths and allocates only the
 * returned `Pose`.
 */
export interface RoutedPath {
  /** Total arc length of the route. */
  readonly length: number;
  /** Whether the path loops back on itself. */
  readonly closed: boolean;
  /** Pose at arc length `s`. Closed paths wrap; open paths clamp to the ends. */
  poseAt(s: number): Pose;
}

function lineSegment(a: Point, b: Point): PathSegment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  return {
    length,
    poseAt(s: number): Pose {
      const t = length === 0 ? 0 : s / length;
      return { x: a.x + dx * t, y: a.y + dy * t, heading };
    },
  };
}

function arcSegment(a: Point, b: Point, center: Point, radius: number): PathSegment {
  const phiA = Math.atan2(a.y - center.y, a.x - center.x);
  const phiB = Math.atan2(b.y - center.y, b.x - center.x);
  // The catalogue always draws the short quarter arc a→b, so fold the raw angle
  // difference into (-π, π]. That sign is the sweep direction and, because the
  // angular speed is constant, dividing s by the radius gives constant linear
  // speed along the arc.
  let sweep = phiB - phiA;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  else if (sweep < -Math.PI) sweep += 2 * Math.PI;

  const length = Math.abs(sweep) * radius;
  const sign = sweep < 0 ? -1 : 1;
  return {
    length,
    poseAt(s: number): Pose {
      const phi = phiA + sweep * (length === 0 ? 0 : s / length);
      // d/dφ of center + r(cos φ, sin φ) is r(-sin φ, cos φ). The heading is the
      // direction of travel, so flip it when the arc sweeps the other way.
      const heading = Math.atan2(sign * Math.cos(phi), -sign * Math.sin(phi));
      return {
        x: center.x + radius * Math.cos(phi),
        y: center.y + radius * Math.sin(phi),
        heading,
      };
    },
  };
}

function shapeSegment(shape: LinkShape, forward: boolean): PathSegment {
  const a = forward ? shape.a : shape.b;
  const b = forward ? shape.b : shape.a;
  return shape.type === 'line'
    ? lineSegment(a, b)
    : arcSegment(a, b, shape.center, shape.radius);
}

/**
 * The path segment for one placed piece entered at connector `from` and left at
 * connector `to`, oriented from → to. Uses the same `linkShapes` geometry the
 * board draws, so the train rides exactly on the rails.
 */
export function stepSegment(piece: PlacedPiece, from: number, to: number): PathSegment {
  const links = rotateDef(piece.kind, piece.rotation).links;
  for (let i = 0; i < links.length; i += 1) {
    const [a, b] = links[i];
    if ((a === from && b === to) || (a === to && b === from)) {
      // `linkShapes` orients a→b along the stored link, hence `a === from`.
      return shapeSegment(linkShapes(piece)[i], a === from);
    }
  }
  throw new Error(
    `stepSegment: ${piece.kind} has no link between connectors ${from} and ${to}`,
  );
}

/**
 * Follow `route` through `layout`, joining its per-piece segments end to end.
 * Segments are stored with their cumulative lengths so `poseAt` is O(log n).
 */
export function routePath(layout: Layout, route: Route): RoutedPath {
  const byId = new Map<string, PlacedPiece>();
  for (const piece of layout.pieces) byId.set(piece.id, piece);

  const { steps } = route;
  const segments: PathSegment[] = new Array(steps.length);
  const cumulative = new Float64Array(steps.length + 1);

  let total = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const piece = byId.get(step.pieceId);
    if (!piece) throw new Error(`routePath: unknown piece id ${step.pieceId}`);
    const segment = stepSegment(piece, step.from, step.to);
    segments[i] = segment;
    total += segment.length;
    cumulative[i + 1] = total;
  }

  const length = total;
  const closed = route.closed;
  const count = segments.length;

  return {
    length,
    closed,
    poseAt(s: number): Pose {
      if (count === 0) throw new Error('routePath: cannot pose an empty route');

      let t = s;
      if (closed) {
        // Wrap s into [0, length); negative s wraps forward too.
        t = length > 0 ? ((t % length) + length) % length : 0;
      } else if (t <= 0) {
        return segments[0].poseAt(0);
      } else if (t >= length) {
        const last = segments[count - 1];
        return last.poseAt(last.length);
      }

      // Largest index with cumulative[index] <= t. Cumulative lengths are
      // non-decreasing, so this pins t to one segment in O(log n) with no
      // allocations.
      let lo = 0;
      let hi = count;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (cumulative[mid] <= t) lo = mid;
        else hi = mid;
      }
      return segments[lo].poseAt(t - cumulative[lo]);
    },
  };
}
