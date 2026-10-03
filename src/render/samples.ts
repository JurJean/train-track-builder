import type { Layout, PieceKind, PlacedPiece, Rotation } from '../model/types';

function piece(
  id: string,
  kind: PieceKind,
  x: number,
  y: number,
  rotation: Rotation,
): PlacedPiece {
  return { id, kind, origin: { x, y }, rotation };
}

/**
 * A small racetrack: two straights along each side, sharp corners, and a
 * station replacing one cell of the left straight. Every connector joins, so it
 * is used in the gallery (and its tests) to show rail joins with no gaps.
 */
export function ovalLayout(): Layout {
  return {
    cols: 6,
    rows: 6,
    pieces: [
      piece('o1', 'curve-sharp', 0, 0, 0),
      piece('o2', 'straight', 1, 0, 1),
      piece('o3', 'straight', 2, 0, 1),
      piece('o4', 'curve-sharp', 3, 0, 1),
      piece('o5', 'straight', 3, 1, 0),
      piece('o6', 'straight', 3, 2, 0),
      piece('o7', 'curve-sharp', 3, 3, 2),
      piece('o8', 'straight', 2, 3, 1),
      piece('o9', 'straight', 1, 3, 1),
      piece('o10', 'curve-sharp', 0, 3, 3),
      piece('o11', 'station', 0, 1, 0),
    ],
  };
}

/**
 * Two lobes meeting at one crossing. The route enters the crossing twice, once
 * through each link, which is the figure-eight the train will run on.
 */
export function figureEightLayout(): Layout {
  return {
    cols: 6,
    rows: 6,
    pieces: [
      piece('f1', 'crossing', 3, 3, 0),
      piece('f2', 'curve-sharp', 4, 3, 2),
      piece('f3', 'curve-sharp', 4, 2, 1),
      piece('f4', 'curve-sharp', 3, 2, 0),
      piece('f5', 'curve-sharp', 3, 4, 2),
      piece('f6', 'curve-sharp', 2, 4, 3),
      piece('f7', 'curve-sharp', 2, 3, 0),
    ],
  };
}
