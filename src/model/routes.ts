import { opposite, rotateDef, step } from './pieces';
import type { Connector, Layout, PlacedPiece, Route, RouteStep } from './types';

/**
 * Route finding and loop detection.
 *
 * The track is a graph whose nodes are piece connectors. Every connector has at
 * most one on-piece link (the two connectors the track runs between) and at
 * most one join (the neighbouring connector it touches). With no switches yet,
 * every connected component is therefore either an open path or a closed loop,
 * which is exactly what the train needs: `primaryLoop` is the longest loop.
 *
 * Walks are done on directed links (`enter at from, leave at to`). Each physical
 * link is consumed once, so a loop is only reported in a single direction even
 * though the reverse walk exists.
 */

interface ConnectorRef {
  readonly piece: number;
  readonly connector: number;
}

interface RouteIndex {
  readonly pieces: readonly PlacedPiece[];
  /** For each connector, the index of the link it belongs to, or -1. */
  readonly linkOfConnector: readonly Int32Array[];
  /** For each connector, its link partner within the same piece, or -1. */
  readonly linkPartner: readonly Int32Array[];
  /** For each connector, the connector it joins across pieces, or null. */
  readonly joinOf: readonly (readonly (ConnectorRef | null)[])[];
}

// The layout is immutable, so an index built for one layout object stays valid
// for the lifetime of that object. Caching keeps repeated queries cheap.
const indexCache = new WeakMap<Layout, RouteIndex>();

// Connector lookups use a flat grid over the layout's bounding box. Above this
// many cells a sparse map is used instead, so a wildly spread-out layout cannot
// force a huge allocation.
const MAX_GRID_CELLS = 1 << 20;

function connectorKey(cell: Connector['cell'], dir: number): string {
  return `${cell.x},${cell.y},${dir}`;
}

function buildIndex(layout: Layout): RouteIndex {
  const cached = indexCache.get(layout);
  if (cached) return cached;

  const { pieces } = layout;
  const count = pieces.length;
  const linkOfConnector: Int32Array[] = new Array(count);
  const linkPartner: Int32Array[] = new Array(count);
  const joinOf: Array<Array<ConnectorRef | null>> = new Array(count);
  const world: Connector[][] = new Array(count);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // First pass: world connectors, link bookkeeping, and the bounding box.
  for (let p = 0; p < count; p += 1) {
    const piece = pieces[p];
    const def = rotateDef(piece.kind, piece.rotation);
    const connectors: Connector[] = new Array(def.connectors.length);
    for (let c = 0; c < def.connectors.length; c += 1) {
      const source = def.connectors[c];
      const cell = {
        x: source.cell.x + piece.origin.x,
        y: source.cell.y + piece.origin.y,
      };
      if (cell.x < minX) minX = cell.x;
      if (cell.x > maxX) maxX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.y > maxY) maxY = cell.y;
      connectors[c] = { cell, dir: source.dir };
    }

    const linkOf = new Int32Array(connectors.length).fill(-1);
    const partner = new Int32Array(connectors.length).fill(-1);
    def.links.forEach(([a, b], linkIndex) => {
      linkOf[a] = linkIndex;
      linkOf[b] = linkIndex;
      partner[a] = b;
      partner[b] = a;
    });

    linkOfConnector[p] = linkOf;
    linkPartner[p] = partner;
    joinOf[p] = new Array<ConnectorRef | null>(connectors.length).fill(null);
    world[p] = connectors;
  }

  // Second pass: a connector joins the neighbour's connector facing back at it.
  const width = count === 0 ? 0 : maxX - minX + 1;
  const height = count === 0 ? 0 : maxY - minY + 1;

  if (width > 0 && height > 0 && width * height <= MAX_GRID_CELLS) {
    const size = width * height * 4;
    const pieceAt = new Int32Array(size);
    const slotAt = new Int32Array(size);

    for (let p = 0; p < count; p += 1) {
      const connectors = world[p];
      for (let c = 0; c < connectors.length; c += 1) {
        const connector = connectors[c];
        const slot =
          ((connector.cell.y - minY) * width + (connector.cell.x - minX)) * 4 +
          connector.dir;
        pieceAt[slot] = p + 1;
        slotAt[slot] = c;
      }
    }

    for (let p = 0; p < count; p += 1) {
      const connectors = world[p];
      for (let c = 0; c < connectors.length; c += 1) {
        const connector = connectors[c];
        const neighbor = step(connector.cell, connector.dir);
        if (
          neighbor.x < minX ||
          neighbor.x > maxX ||
          neighbor.y < minY ||
          neighbor.y > maxY
        ) {
          continue;
        }
        const slot =
          ((neighbor.y - minY) * width + (neighbor.x - minX)) * 4 +
          opposite(connector.dir);
        const encoded = pieceAt[slot];
        if (encoded !== 0) {
          joinOf[p][c] = { piece: encoded - 1, connector: slotAt[slot] };
        }
      }
    }
  } else {
    const refs = new Map<string, ConnectorRef>();
    for (let p = 0; p < count; p += 1) {
      const connectors = world[p];
      for (let c = 0; c < connectors.length; c += 1) {
        refs.set(connectorKey(connectors[c].cell, connectors[c].dir), {
          piece: p,
          connector: c,
        });
      }
    }
    for (let p = 0; p < count; p += 1) {
      const connectors = world[p];
      for (let c = 0; c < connectors.length; c += 1) {
        const connector = connectors[c];
        const neighbor = step(connector.cell, connector.dir);
        const ref = refs.get(connectorKey(neighbor, opposite(connector.dir)));
        if (ref) joinOf[p][c] = ref;
      }
    }
  }

  const index: RouteIndex = { pieces, linkOfConnector, linkPartner, joinOf };
  indexCache.set(layout, index);
  return index;
}

/** True when some connector can walk into `piece` at `from` and onto its link. */
function hasPredecessor(index: RouteIndex, piece: number, from: number): boolean {
  const join = index.joinOf[piece][from];
  if (!join) return false;
  return index.linkPartner[join.piece][join.connector] >= 0;
}

/**
 * Walk forward from one directed link until the route closes, dead-ends at an
 * open connector, or reaches a buffer stop. Marks every link it consumes.
 */
function walkFrom(
  index: RouteIndex,
  used: Uint8Array[],
  startPiece: number,
  startFrom: number,
): { steps: RouteStep[]; closed: boolean } {
  const steps: RouteStep[] = [];
  let piece = startPiece;
  let from = startFrom;
  let to = index.linkPartner[piece][from];

  for (;;) {
    const linkIndex = index.linkOfConnector[piece][from];
    if (used[piece][linkIndex] === 1) break;
    used[piece][linkIndex] = 1;
    steps.push({ pieceId: index.pieces[piece].id, from, to });

    const join = index.joinOf[piece][to];
    if (!join) break;

    const nextFrom = join.connector;
    const nextTo = index.linkPartner[join.piece][nextFrom];
    if (nextTo < 0) break; // buffer stop: the track ends here.

    if (join.piece === startPiece && nextFrom === startFrom) {
      return { steps, closed: true };
    }

    piece = join.piece;
    from = nextFrom;
    to = nextTo;
  }

  return { steps, closed: false };
}

/** Natural ordering for piece ids: `p2` sorts before `p10`. */
function compareIds(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) {
    const na = Number(ma[2]);
    const nb = Number(mb[2]);
    if (na !== nb) return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function stepPrecedes(a: RouteStep, b: RouteStep): boolean {
  const byId = compareIds(a.pieceId, b.pieceId);
  if (byId !== 0) return byId < 0;
  if (a.from !== b.from) return a.from < b.from;
  return a.to < b.to;
}

/** Rotate a closed route so it starts on its lowest piece id. */
function rotateToLowest(steps: RouteStep[]): RouteStep[] {
  let best = 0;
  for (let i = 1; i < steps.length; i += 1) {
    if (stepPrecedes(steps[i], steps[best])) best = i;
  }
  if (best === 0) return steps;
  return [...steps.slice(best), ...steps.slice(0, best)];
}

function lowestPieceId(route: Route): string {
  let lowest = route.steps[0].pieceId;
  for (const step of route.steps) {
    if (compareIds(step.pieceId, lowest) < 0) lowest = step.pieceId;
  }
  return lowest;
}

/**
 * Walk the whole layout. Every link of every piece appears in exactly one
 * route, in one direction. Open routes start at an end; closed routes start on
 * their lowest piece id so the train's position is stable.
 */
export function findRoutes(layout: Layout): Route[] {
  const index = buildIndex(layout);
  const used: Uint8Array[] = index.pieces.map(
    (_, p) => new Uint8Array(index.linkOfConnector[p].length),
  );
  const routes: Route[] = [];

  // Open paths first, so each one is walked from an end rather than from an
  // arbitrary link in the middle.
  for (let p = 0; p < index.pieces.length; p += 1) {
    const partner = index.linkPartner[p];
    for (let from = 0; from < partner.length; from += 1) {
      if (partner[from] < 0) continue;
      if (used[p][index.linkOfConnector[p][from]] === 1) continue;
      if (hasPredecessor(index, p, from)) continue;

      const { steps, closed } = walkFrom(index, used, p, from);
      if (steps.length > 0) routes.push({ steps, closed });
    }
  }

  // Anything still unused has no end, so it is a closed loop.
  for (let p = 0; p < index.pieces.length; p += 1) {
    const partner = index.linkPartner[p];
    for (let from = 0; from < partner.length; from += 1) {
      if (partner[from] < 0) continue;
      if (used[p][index.linkOfConnector[p][from]] === 1) continue;

      const { steps, closed } = walkFrom(index, used, p, from);
      if (steps.length === 0) continue;
      routes.push({ steps: closed ? rotateToLowest(steps) : steps, closed });
    }
  }

  return routes;
}

/** Every complete loop in the layout. */
export function closedLoops(layout: Layout): Route[] {
  return findRoutes(layout).filter((route) => route.closed);
}

/** True when the track forms at least one complete loop, so Go! can light up. */
export function hasClosedLoop(layout: Layout): boolean {
  return findRoutes(layout).some((route) => route.closed);
}

/**
 * The closed loop the train runs on: the longest by step count. Ties go to the
 * route containing the lowest piece id.
 */
export function primaryLoop(layout: Layout): Route | null {
  let best: Route | null = null;
  let bestLowest = '';

  for (const route of closedLoops(layout)) {
    if (best === null || route.steps.length > best.steps.length) {
      best = route;
      bestLowest = lowestPieceId(route);
      continue;
    }
    if (route.steps.length < best.steps.length) continue;

    const lowest = lowestPieceId(route);
    if (compareIds(lowest, bestLowest) < 0) {
      best = route;
      bestLowest = lowest;
    }
  }

  return best;
}
