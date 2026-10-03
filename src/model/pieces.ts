import type {
  Cell,
  Connector,
  Dir,
  LinkShape,
  PieceDef,
  PieceKind,
  PlacedPiece,
  Point,
  Rotation,
} from './types';

export const GRID_COLS = 32;
export const GRID_ROWS = 24;

function line(a: Point, b: Point): LinkShape {
  return { type: 'line', a, b };
}

function arc(a: Point, b: Point, center: Point, radius: number): LinkShape {
  return { type: 'arc', a, b, center, radius };
}

const STRAIGHT: PieceDef = {
  kind: 'straight',
  footprint: [{ x: 0, y: 0 }],
  connectors: [
    { cell: { x: 0, y: 0 }, dir: 0 },
    { cell: { x: 0, y: 0 }, dir: 2 },
  ],
  links: [[0, 1]],
  shapes: [line({ x: 0.5, y: 0 }, { x: 0.5, y: 1 })],
};

const CURVE_SHARP: PieceDef = {
  kind: 'curve-sharp',
  footprint: [{ x: 0, y: 0 }],
  connectors: [
    { cell: { x: 0, y: 0 }, dir: 2 },
    { cell: { x: 0, y: 0 }, dir: 1 },
  ],
  links: [[0, 1]],
  shapes: [arc({ x: 0.5, y: 1 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, 0.5)],
};

const CURVE_GENTLE: PieceDef = {
  kind: 'curve-gentle',
  footprint: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  connectors: [
    { cell: { x: 0, y: 1 }, dir: 2 },
    { cell: { x: 1, y: 0 }, dir: 1 },
  ],
  links: [[0, 1]],
  shapes: [arc({ x: 0.5, y: 2 }, { x: 2, y: 0.5 }, { x: 2, y: 2 }, 1.5)],
};

const CROSSING: PieceDef = {
  kind: 'crossing',
  footprint: [{ x: 0, y: 0 }],
  connectors: [
    { cell: { x: 0, y: 0 }, dir: 0 },
    { cell: { x: 0, y: 0 }, dir: 1 },
    { cell: { x: 0, y: 0 }, dir: 2 },
    { cell: { x: 0, y: 0 }, dir: 3 },
  ],
  links: [
    [0, 2],
    [1, 3],
  ],
  shapes: [
    line({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }),
    line({ x: 1, y: 0.5 }, { x: 0, y: 0.5 }),
  ],
};

const STATION: PieceDef = {
  kind: 'station',
  footprint: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  connectors: [
    { cell: { x: 0, y: 0 }, dir: 0 },
    { cell: { x: 0, y: 1 }, dir: 2 },
  ],
  links: [[0, 1]],
  shapes: [line({ x: 0.5, y: 0 }, { x: 0.5, y: 2 })],
};

const BUFFER_STOP: PieceDef = {
  kind: 'buffer-stop',
  footprint: [{ x: 0, y: 0 }],
  connectors: [{ cell: { x: 0, y: 0 }, dir: 2 }],
  links: [],
  shapes: [],
};

// Bridge and tunnel follow the same track geometry as a straight; only the art differs.
const BRIDGE: PieceDef = { ...STRAIGHT, kind: 'bridge' };
const TUNNEL: PieceDef = { ...STRAIGHT, kind: 'tunnel' };

export const PIECES: Record<PieceKind, PieceDef> = {
  straight: STRAIGHT,
  'curve-gentle': CURVE_GENTLE,
  'curve-sharp': CURVE_SHARP,
  crossing: CROSSING,
  bridge: BRIDGE,
  tunnel: TUNNEL,
  station: STATION,
  'buffer-stop': BUFFER_STOP,
};

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function step(cell: Cell, d: Dir): Cell {
  switch (d) {
    case 0:
      return { x: cell.x, y: cell.y - 1 };
    case 1:
      return { x: cell.x + 1, y: cell.y };
    case 2:
      return { x: cell.x, y: cell.y + 1 };
    case 3:
      return { x: cell.x - 1, y: cell.y };
  }
}

function footprintSize(cells: readonly Cell[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const cell of cells) {
    w = Math.max(w, cell.x + 1);
    h = Math.max(h, cell.y + 1);
  }
  return { w, h };
}

function mapPoint(p: Point, h: number): Point {
  return { x: h - p.y, y: p.x };
}

function mapShape(shape: LinkShape, h: number): LinkShape {
  if (shape.type === 'line') {
    return { type: 'line', a: mapPoint(shape.a, h), b: mapPoint(shape.b, h) };
  }
  return {
    type: 'arc',
    a: mapPoint(shape.a, h),
    b: mapPoint(shape.b, h),
    center: mapPoint(shape.center, h),
    radius: shape.radius,
  };
}

function rotateOnce(def: PieceDef): PieceDef {
  const { h } = footprintSize(def.footprint);
  return {
    kind: def.kind,
    footprint: def.footprint.map((cell) => ({ x: h - 1 - cell.y, y: cell.x })),
    connectors: def.connectors.map((connector) => ({
      cell: { x: h - 1 - connector.cell.y, y: connector.cell.x },
      dir: ((connector.dir + 1) % 4) as Dir,
    })),
    links: def.links,
    shapes: def.shapes.map((shape) => mapShape(shape, h)),
  };
}

// Rotation is pure and heavily reused (every occupancy and connector lookup),
// so memoise the handful of (kind, rotation) combinations.
const rotationCache: Partial<Record<PieceKind, PieceDef[]>> = {};

export function rotateDef(kind: PieceKind, rotation: Rotation): PieceDef {
  let byRotation = rotationCache[kind];
  if (!byRotation) {
    byRotation = [PIECES[kind]];
    rotationCache[kind] = byRotation;
  }

  for (let i = 1; i <= rotation; i += 1) {
    if (!byRotation[i]) byRotation[i] = rotateOnce(byRotation[i - 1]);
  }
  return byRotation[rotation];
}

export function occupiedCells(p: PlacedPiece): Cell[] {
  return rotateDef(p.kind, p.rotation).footprint.map((cell) => ({
    x: cell.x + p.origin.x,
    y: cell.y + p.origin.y,
  }));
}

export function worldConnectors(p: PlacedPiece): Connector[] {
  return rotateDef(p.kind, p.rotation).connectors.map((connector) => ({
    cell: {
      x: connector.cell.x + p.origin.x,
      y: connector.cell.y + p.origin.y,
    },
    dir: connector.dir,
  }));
}

export function connectorPoint(c: Connector): Point {
  const { x, y } = c.cell;
  switch (c.dir) {
    case 0:
      return { x: x + 0.5, y };
    case 1:
      return { x: x + 1, y: y + 0.5 };
    case 2:
      return { x: x + 0.5, y: y + 1 };
    case 3:
      return { x, y: y + 0.5 };
  }
}

function translateShape(shape: LinkShape, dx: number, dy: number): LinkShape {
  if (shape.type === 'line') {
    return {
      type: 'line',
      a: { x: shape.a.x + dx, y: shape.a.y + dy },
      b: { x: shape.b.x + dx, y: shape.b.y + dy },
    };
  }
  return {
    type: 'arc',
    a: { x: shape.a.x + dx, y: shape.a.y + dy },
    b: { x: shape.b.x + dx, y: shape.b.y + dy },
    center: { x: shape.center.x + dx, y: shape.center.y + dy },
    radius: shape.radius,
  };
}

export function linkShapes(p: PlacedPiece): LinkShape[] {
  return rotateDef(p.kind, p.rotation).shapes.map((shape) =>
    translateShape(shape, p.origin.x, p.origin.y),
  );
}
