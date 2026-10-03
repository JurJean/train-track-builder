import { GRID_COLS, GRID_ROWS, opposite, rotateDef, step } from './pieces';
import type { Cell, Dir, Layout, PieceKind, PlacedPiece, Rotation } from './types';

export type PlacementReason = 'out-of-bounds' | 'overlap';

export type PlacementCheck =
  | { ok: true; joins: number }
  | { ok: false; reason: PlacementReason };

export interface Placement {
  layout: Layout;
  piece: PlacedPiece;
  joins: number;
}

export interface Removal {
  layout: Layout;
  removed: PlacedPiece | null;
}

/** A reference to one connector of one placed piece. */
export interface Connection {
  pieceId: string;
  connector: number;
}

interface LayoutIndex {
  cols: number;
  rows: number;
  /** Piece index + 1 occupying each cell, or 0 when free. */
  cellPiece: Uint32Array;
  /** Piece index + 1 owning each (cell, dir) connector, or 0 when none. */
  connectorPiece: Uint32Array;
  /** Connector number within the owning piece, for each (cell, dir). */
  connectorSlot: Uint32Array;
}

// The layout is immutable, so an index built for one layout object stays valid
// for the lifetime of that object. Caching it here keeps pointer-move checks
// cheap: the grid is walked once per layout rather than once per check.
const indexCache = new WeakMap<Layout, LayoutIndex>();

function buildIndex(layout: Layout): LayoutIndex {
  const cached = indexCache.get(layout);
  if (cached) return cached;

  const { cols, rows } = layout;
  // Zero-initialised: 0 means "empty", so no fill pass is needed.
  const cellPiece = new Uint32Array(cols * rows);
  const connectorPiece = new Uint32Array(cols * rows * 4);
  const connectorSlot = new Uint32Array(cols * rows * 4);

  const { pieces } = layout;
  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex];
    const def = rotateDef(piece.kind, piece.rotation);
    const ox = piece.origin.x;
    const oy = piece.origin.y;

    for (const cell of def.footprint) {
      cellPiece[(cell.y + oy) * cols + (cell.x + ox)] = pieceIndex + 1;
    }
    for (let connectorIndex = 0; connectorIndex < def.connectors.length; connectorIndex += 1) {
      const connector = def.connectors[connectorIndex];
      const base = ((connector.cell.y + oy) * cols + (connector.cell.x + ox)) * 4 + connector.dir;
      connectorPiece[base] = pieceIndex + 1;
      connectorSlot[base] = connectorIndex;
    }
  }

  const index: LayoutIndex = { cols, rows, cellPiece, connectorPiece, connectorSlot };
  indexCache.set(layout, index);
  return index;
}

/** The existing connector sharing an edge with `cell`/`dir`, if any. */
function joinedAt(
  index: LayoutIndex,
  cell: Cell,
  dir: Dir,
): { pieceIndex: number; connector: number } | null {
  const neighbor = step(cell, dir);
  if (
    neighbor.x < 0 ||
    neighbor.y < 0 ||
    neighbor.x >= index.cols ||
    neighbor.y >= index.rows
  ) {
    return null;
  }
  const base = (neighbor.y * index.cols + neighbor.x) * 4 + opposite(dir);
  const encoded = index.connectorPiece[base];
  if (encoded === 0) return null;
  return { pieceIndex: encoded - 1, connector: index.connectorSlot[base] };
}

function connectorCells(
  kind: PieceKind,
  origin: Cell,
  rotation: Rotation,
): { cell: Cell; dir: Dir }[] {
  return rotateDef(kind, rotation).connectors.map((connector) => ({
    cell: { x: connector.cell.x + origin.x, y: connector.cell.y + origin.y },
    dir: connector.dir,
  }));
}

export function emptyLayout(): Layout {
  return { cols: GRID_COLS, rows: GRID_ROWS, pieces: [] };
}

export function checkPlacement(
  layout: Layout,
  kind: PieceKind,
  origin: Cell,
  rotation: Rotation,
): PlacementCheck {
  const def = rotateDef(kind, rotation);
  const { cols, rows } = layout;

  for (const cell of def.footprint) {
    const x = cell.x + origin.x;
    const y = cell.y + origin.y;
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return { ok: false, reason: 'out-of-bounds' };
    }
  }

  const index = buildIndex(layout);
  for (const cell of def.footprint) {
    const x = cell.x + origin.x;
    const y = cell.y + origin.y;
    if (index.cellPiece[y * cols + x] !== 0) {
      return { ok: false, reason: 'overlap' };
    }
  }

  let joins = 0;
  for (const connector of def.connectors) {
    const cell = { x: connector.cell.x + origin.x, y: connector.cell.y + origin.y };
    if (joinedAt(index, cell, connector.dir)) joins += 1;
  }
  return { ok: true, joins };
}

/** The next deterministic id: one above the highest existing `pN`. */
export function nextPieceId(layout: Layout): string {
  let highest = 0;
  for (const piece of layout.pieces) {
    const match = /^p(\d+)$/.exec(piece.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `p${highest + 1}`;
}

export function placePiece(
  layout: Layout,
  kind: PieceKind,
  origin: Cell,
  rotation: Rotation,
): Placement | null {
  const check = checkPlacement(layout, kind, origin, rotation);
  if (!check.ok) return null;

  const piece: PlacedPiece = {
    id: nextPieceId(layout),
    kind,
    origin: { x: origin.x, y: origin.y },
    rotation,
  };
  const next: Layout = {
    cols: layout.cols,
    rows: layout.rows,
    pieces: [...layout.pieces, piece],
  };
  return { layout: next, piece, joins: check.joins };
}

export function pieceAt(layout: Layout, cell: Cell): PlacedPiece | null {
  if (cell.x < 0 || cell.y < 0 || cell.x >= layout.cols || cell.y >= layout.rows) {
    return null;
  }
  const encoded = buildIndex(layout).cellPiece[cell.y * layout.cols + cell.x];
  return encoded !== 0 ? layout.pieces[encoded - 1] : null;
}

export function removePieceAt(layout: Layout, cell: Cell): Removal {
  const piece = pieceAt(layout, cell);
  if (!piece) return { layout, removed: null };

  const next: Layout = {
    cols: layout.cols,
    rows: layout.rows,
    pieces: layout.pieces.filter((candidate) => candidate.id !== piece.id),
  };
  return { layout: next, removed: piece };
}

/** For each connector of `pieceId`, the connector it joins, or null. */
export function connectionsOf(layout: Layout, pieceId: string): Array<Connection | null> {
  const piece = layout.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return [];

  const index = buildIndex(layout);
  return connectorCells(piece.kind, piece.origin, piece.rotation).map((connector) => {
    const joined = joinedAt(index, connector.cell, connector.dir);
    return joined
      ? { pieceId: layout.pieces[joined.pieceIndex].id, connector: joined.connector }
      : null;
  });
}

/** Every connector in the layout with nothing attached. */
export function openEnds(layout: Layout): Connection[] {
  const index = buildIndex(layout);
  const ends: Connection[] = [];

  layout.pieces.forEach((piece, pieceIndex) => {
    connectorCells(piece.kind, piece.origin, piece.rotation).forEach((connector, slot) => {
      if (!joinedAt(index, connector.cell, connector.dir)) {
        ends.push({ pieceId: layout.pieces[pieceIndex].id, connector: slot });
      }
    });
  });
  return ends;
}
