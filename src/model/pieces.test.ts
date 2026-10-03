import { describe, expect, it } from 'vitest';
import type { Cell, Connector, Dir, PieceKind, PlacedPiece, Rotation } from './types';
import {
  PIECES,
  connectorPoint,
  linkShapes,
  occupiedCells,
  rotateDef,
  worldConnectors,
} from './pieces';

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

const c = (x: number, y: number, dir: Dir): Connector => ({ cell: { x, y }, dir });

const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;
const footprintKeys = (cells: readonly Cell[]): string[] => cells.map(cellKey).sort();

const STRAIGHT_CONNECTORS: Connector[][] = [
  [c(0, 0, 0), c(0, 0, 2)],
  [c(0, 0, 1), c(0, 0, 3)],
  [c(0, 0, 2), c(0, 0, 0)],
  [c(0, 0, 3), c(0, 0, 1)],
];

// Expected absolute connector lists, indexed by rotation, for every catalogue piece.
const EXPECTED_CONNECTORS: Record<PieceKind, Connector[][]> = {
  straight: STRAIGHT_CONNECTORS,
  bridge: STRAIGHT_CONNECTORS,
  tunnel: STRAIGHT_CONNECTORS,
  'curve-sharp': [
    [c(0, 0, 2), c(0, 0, 1)],
    [c(0, 0, 3), c(0, 0, 2)],
    [c(0, 0, 0), c(0, 0, 3)],
    [c(0, 0, 1), c(0, 0, 0)],
  ],
  'curve-gentle': [
    [c(0, 1, 2), c(1, 0, 1)],
    [c(0, 0, 3), c(1, 1, 2)],
    [c(1, 0, 0), c(0, 1, 3)],
    [c(1, 1, 1), c(0, 0, 0)],
  ],
  crossing: [
    [c(0, 0, 0), c(0, 0, 1), c(0, 0, 2), c(0, 0, 3)],
    [c(0, 0, 1), c(0, 0, 2), c(0, 0, 3), c(0, 0, 0)],
    [c(0, 0, 2), c(0, 0, 3), c(0, 0, 0), c(0, 0, 1)],
    [c(0, 0, 3), c(0, 0, 0), c(0, 0, 1), c(0, 0, 2)],
  ],
  station: [
    [c(0, 0, 0), c(0, 1, 2)],
    [c(1, 0, 1), c(0, 0, 3)],
    [c(0, 1, 2), c(0, 0, 0)],
    [c(0, 0, 3), c(1, 0, 1)],
  ],
  'buffer-stop': [[c(0, 0, 2)], [c(0, 0, 3)], [c(0, 0, 0)], [c(0, 0, 1)]],
};

describe('PIECES catalogue', () => {
  it('defines every piece kind', () => {
    expect(Object.keys(PIECES).sort()).toEqual([...KINDS].sort());
  });

  it('keeps links and shapes aligned', () => {
    for (const kind of KINDS) {
      expect(PIECES[kind].shapes).toHaveLength(PIECES[kind].links.length);
    }
  });
});

describe('rotateDef', () => {
  it('gives back the original after four clockwise rotations', () => {
    const fourRotations = 4 as number as Rotation;
    for (const kind of KINDS) {
      expect(rotateDef(kind, fourRotations)).toEqual(PIECES[kind]);
    }
  });

  it('produces the correct connectors for every kind at every rotation', () => {
    for (const kind of KINDS) {
      ROTATIONS.forEach((rotation) => {
        expect(rotateDef(kind, rotation).connectors).toEqual(
          EXPECTED_CONNECTORS[kind][rotation],
        );
      });
    }
  });

  it('maps the gentle-curve footprint to the full 2x2 block at every rotation', () => {
    for (const rotation of ROTATIONS) {
      expect(footprintKeys(rotateDef('curve-gentle', rotation).footprint)).toEqual([
        '0,0',
        '0,1',
        '1,0',
        '1,1',
      ]);
    }
  });

  it('maps the station footprint 1x2 / 2x1 as it turns', () => {
    const expected: Record<Rotation, string[]> = {
      0: ['0,0', '0,1'],
      1: ['0,0', '1,0'],
      2: ['0,0', '0,1'],
      3: ['0,0', '1,0'],
    };
    for (const rotation of ROTATIONS) {
      expect(footprintKeys(rotateDef('station', rotation).footprint)).toEqual(
        expected[rotation],
      );
    }
  });
});

describe('absolute geometry', () => {
  it('offsets occupied cells by the origin', () => {
    const piece: PlacedPiece = {
      id: 'a',
      kind: 'station',
      origin: { x: 4, y: 7 },
      rotation: 0,
    };
    expect(occupiedCells(piece).map(cellKey).sort()).toEqual(['4,7', '4,8']);
  });

  it('puts link shape endpoints on their connectors for every kind and rotation', () => {
    for (const kind of KINDS) {
      const links = PIECES[kind].links;
      for (const rotation of ROTATIONS) {
        const piece: PlacedPiece = {
          id: 'p',
          kind,
          origin: { x: 3, y: 5 },
          rotation,
        };
        const connectors = worldConnectors(piece);
        const shapes = linkShapes(piece);

        expect(shapes).toHaveLength(links.length);
        links.forEach(([from, to], index) => {
          expect(shapes[index].a).toEqual(connectorPoint(connectors[from]));
          expect(shapes[index].b).toEqual(connectorPoint(connectors[to]));
        });
      }
    }
  });
});
