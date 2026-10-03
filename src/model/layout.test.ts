import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from './pieces';
import {
  checkPlacement,
  connectionsOf,
  emptyLayout,
  nextPieceId,
  openEnds,
  pieceAt,
  placePiece,
  removePieceAt,
} from './layout';
import type { Cell, Layout, PieceKind, PlacedPiece, Rotation } from './types';

const at = (x: number, y: number): Cell => ({ x, y });

/**
 * A tiny mutable wrapper around an immutable layout so tests can place pieces
 * and keep checking against the result, like the editor does.
 */
function fixture() {
  let layout = emptyLayout();
  return {
    get layout(): Layout {
      return layout;
    },
    put(kind: PieceKind, x: number, y: number, rotation: Rotation = 0): PlacedPiece {
      const result = placePiece(layout, kind, at(x, y), rotation);
      if (!result) throw new Error(`fixture placement failed: ${kind} ${x},${y} r${rotation}`);
      layout = result.layout;
      return result.piece;
    },
    check(kind: PieceKind, x: number, y: number, rotation: Rotation = 0) {
      return checkPlacement(layout, kind, at(x, y), rotation);
    },
  };
}

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

describe('emptyLayout', () => {
  it('is the catalogue grid with no pieces', () => {
    const layout = emptyLayout();
    expect(layout.cols).toBe(GRID_COLS);
    expect(layout.rows).toBe(GRID_ROWS);
    expect(layout.pieces).toEqual([]);
  });
});

describe('checkPlacement bounds', () => {
  it('rejects a piece poking past each of the four edges', () => {
    const layout = emptyLayout();
    const cases: Array<[string, Cell]> = [
      ['west', at(-1, 5)],
      ['east', at(GRID_COLS, 5)],
      ['north', at(5, -1)],
      ['south', at(5, GRID_ROWS)],
    ];
    for (const [edge, origin] of cases) {
      const check = checkPlacement(layout, 'straight', origin, 0);
      expect(check, edge).toEqual({ ok: false, reason: 'out-of-bounds' });
    }
  });

  it('rejects a multi-cell footprint that only partly leaves the grid', () => {
    const layout = emptyLayout();
    // Gentle curves fill a 2x2 block, so sitting on the last column spills over.
    expect(checkPlacement(layout, 'curve-gentle', at(GRID_COLS - 1, 0), 0)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
    // Stations are 1x2, so sitting on the last row spills over.
    expect(checkPlacement(layout, 'station', at(0, GRID_ROWS - 1), 0)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
  });

  it('accepts pieces flush against the edges', () => {
    const layout = emptyLayout();
    expect(checkPlacement(layout, 'straight', at(0, 0), 0).ok).toBe(true);
    expect(checkPlacement(layout, 'straight', at(GRID_COLS - 1, GRID_ROWS - 1), 0).ok).toBe(
      true,
    );
  });
});

describe('checkPlacement overlap', () => {
  it('rejects a gentle curve on top of itself at every rotation', () => {
    for (const rotation of ROTATIONS) {
      const f = fixture();
      f.put('curve-gentle', 5, 5, rotation);
      expect(f.check('curve-gentle', 5, 5, rotation), `r${rotation}`).toEqual({
        ok: false,
        reason: 'overlap',
      });
    }
  });

  it('rejects a station on top of itself at every rotation', () => {
    for (const rotation of ROTATIONS) {
      const f = fixture();
      f.put('station', 5, 5, rotation);
      expect(f.check('station', 5, 5, rotation), `r${rotation}`).toEqual({
        ok: false,
        reason: 'overlap',
      });
    }
  });

  it('rejects a partial overlap with just one shared cell', () => {
    const curvy = fixture();
    curvy.put('curve-gentle', 5, 5, 0); // fills (5,5)..(6,6)
    expect(curvy.check('curve-gentle', 6, 6, 0)).toEqual({ ok: false, reason: 'overlap' });

    const station = fixture();
    station.put('station', 5, 5, 1); // horizontal, fills (5,5),(6,5)
    expect(station.check('station', 6, 5, 1)).toEqual({ ok: false, reason: 'overlap' });
  });
});

describe('checkPlacement joins', () => {
  it('counts one join when an end meets an existing end', () => {
    const f = fixture();
    f.put('straight', 5, 5, 0);
    expect(f.check('straight', 5, 6, 0)).toEqual({ ok: true, joins: 1 });
  });

  it('counts two joins when both ends connect', () => {
    const f = fixture();
    f.put('straight', 5, 4, 0);
    f.put('straight', 5, 6, 0);
    expect(f.check('straight', 5, 5, 0)).toEqual({ ok: true, joins: 2 });
  });

  it('does not count side-by-side neighbours that share no edge', () => {
    const f = fixture();
    f.put('straight', 5, 5, 0);
    expect(f.check('straight', 6, 5, 0)).toEqual({ ok: true, joins: 0 });
  });

  it('counts all four joins of a crossing among four neighbours', () => {
    const f = fixture();
    f.put('straight', 5, 4, 0); // north
    f.put('straight', 6, 5, 1); // east
    f.put('straight', 5, 6, 0); // south
    f.put('straight', 4, 5, 1); // west
    expect(f.check('crossing', 5, 5, 0)).toEqual({ ok: true, joins: 4 });
  });

  it('exposes the joined connectors through connectionsOf', () => {
    const f = fixture();
    const crossing = f.put('crossing', 5, 5, 0);
    const north = f.put('straight', 5, 4, 0);

    const crossingLinks = connectionsOf(f.layout, crossing.id);
    expect(crossingLinks).toHaveLength(4);
    expect(crossingLinks[0]).toEqual({ pieceId: north.id, connector: 1 });
    expect(crossingLinks[1]).toBeNull();
    expect(crossingLinks[2]).toBeNull();
    expect(crossingLinks[3]).toBeNull();

    // The straight's exposed end is at its south side and joins the crossing.
    expect(connectionsOf(f.layout, north.id)).toEqual([
      null,
      { pieceId: crossing.id, connector: 0 },
    ]);
  });
});

describe('openEnds', () => {
  it('lists every unattached connector and drops joined ones', () => {
    const f = fixture();
    const first = f.put('straight', 5, 5, 0); // two ends
    expect(openEnds(f.layout)).toEqual([
      { pieceId: first.id, connector: 0 },
      { pieceId: first.id, connector: 1 },
    ]);

    const second = f.put('straight', 5, 6, 0); // joins the first, adds one end
    const ends = openEnds(f.layout);
    expect(ends).toHaveLength(2);
    expect(ends).toContainEqual({ pieceId: first.id, connector: 0 });
    expect(ends).toContainEqual({ pieceId: second.id, connector: 1 });
    expect(ends).not.toContainEqual({ pieceId: first.id, connector: 1 });
  });
});

describe('pieceAt and removePieceAt', () => {
  it('finds and removes a piece through any of its cells', () => {
    const f = fixture();
    const station = f.put('station', 5, 5, 0); // fills (5,5),(5,6)
    expect(pieceAt(f.layout, at(5, 5))?.id).toBe(station.id);
    expect(pieceAt(f.layout, at(5, 6))?.id).toBe(station.id);

    const removal = removePieceAt(f.layout, at(5, 6));
    expect(removal.removed?.id).toBe(station.id);
    expect(removal.layout.pieces).toHaveLength(0);
    expect(pieceAt(removal.layout, at(5, 5))).toBeNull();
  });

  it('removes a whole gentle curve through a corner cell', () => {
    const f = fixture();
    const curve = f.put('curve-gentle', 5, 5, 0); // (5,5)..(6,6)
    const removal = removePieceAt(f.layout, at(6, 6));
    expect(removal.removed?.id).toBe(curve.id);
    expect(removal.layout.pieces).toEqual([]);
  });

  it('does nothing when no piece covers the cell', () => {
    const f = fixture();
    f.put('straight', 5, 5, 0);
    const removal = removePieceAt(f.layout, at(0, 0));
    expect(removal.removed).toBeNull();
    expect(removal.layout).toBe(f.layout);
  });
});

describe('deterministic ids', () => {
  it('numbers one above the highest existing id', () => {
    const f = fixture();
    expect(nextPieceId(f.layout)).toBe('p1');
    f.put('straight', 1, 1);
    expect(nextPieceId(f.layout)).toBe('p2');
    f.put('straight', 3, 1);
    expect(nextPieceId(f.layout)).toBe('p3');
  });

  it('stays unique after a remove followed by a place', () => {
    const f = fixture();
    f.put('straight', 1, 1);
    f.put('straight', 3, 1);
    f.put('straight', 5, 1);
    expect(f.layout.pieces.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);

    // Remove the middle piece, then place: the next id is above the highest.
    const removal = removePieceAt(f.layout, at(3, 1));
    expect(removal.removed?.id).toBe('p2');
    const placed = placePiece(removal.layout, 'straight', at(3, 1), 0);
    expect(placed?.piece.id).toBe('p4');
    const ids = placed!.layout.pieces.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reuses an id once the piece holding it is gone', () => {
    const f = fixture();
    f.put('straight', 1, 1);
    f.put('straight', 3, 1);
    f.put('straight', 5, 1);
    const removal = removePieceAt(f.layout, at(5, 1)); // removes p3, the highest
    expect(removal.removed?.id).toBe('p3');
    const placed = placePiece(removal.layout, 'straight', at(5, 1), 0);
    expect(placed?.piece.id).toBe('p3');
    const ids = placed!.layout.pieces.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('checkPlacement performance', () => {
  function buildThousandPieceLayout(): Layout {
    const pieces: PlacedPiece[] = [];
    for (let i = 0; i < 1000; i += 1) {
      pieces.push({
        id: `p${i + 1}`,
        kind: 'straight',
        origin: { x: i % 64, y: Math.floor(i / 64) },
        rotation: 0,
      });
    }
    return { cols: 64, rows: 32, pieces };
  }

  it('checks a fresh 1,000-piece layout and warmed repeats under 1 ms', () => {
    // Cold: building the occupancy index for a brand new layout. Take the best
    // of a few runs so a stray GC pause in CI cannot fail the check.
    let cold = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i += 1) {
      const layout = buildThousandPieceLayout();
      const start = performance.now();
      checkPlacement(layout, 'straight', at(63, 20), 0);
      cold = Math.min(cold, performance.now() - start);
    }

    // Warm: the cached index, as every pointer move after the first would see.
    const layout = buildThousandPieceLayout();
    checkPlacement(layout, 'straight', at(63, 20), 0);
    const iterations = 1000;
    const warmStart = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      checkPlacement(layout, 'straight', at(63, 20), 0);
    }
    const average = (performance.now() - warmStart) / iterations;

    expect(cold).toBeLessThan(1);
    expect(average).toBeLessThan(1);
  });
});
