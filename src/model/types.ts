export type Dir = 0 | 1 | 2 | 3;        // 0 N (-y), 1 E (+x), 2 S (+y), 3 W (-x)
export type Rotation = 0 | 1 | 2 | 3;   // clockwise quarter turns
export type PieceKind = 'straight' | 'curve-gentle' | 'curve-sharp' | 'crossing'
  | 'bridge' | 'tunnel' | 'station' | 'buffer-stop';
export interface Cell { x: number; y: number }   // cell (x,y) covers world [x,x+1]×[y,y+1]
export interface Point { x: number; y: number }  // world units, 1 = one cell
export interface Connector { cell: Cell; dir: Dir } // side `dir` of `cell`
export type LinkShape =
  | { type: 'line'; a: Point; b: Point }
  | { type: 'arc'; a: Point; b: Point; center: Point; radius: number }; // quarter arc a→b
export interface PieceDef { kind: PieceKind; footprint: Cell[]; connectors: Connector[];
  links: [number, number][]; shapes: LinkShape[] } // rotation 0, relative to origin; shapes[i] is links[i]
export interface PlacedPiece { id: string; kind: PieceKind; origin: Cell; rotation: Rotation }
export interface Layout { cols: number; rows: number; pieces: readonly PlacedPiece[] } // immutable
export interface Pose { x: number; y: number; heading: number } // radians, 0 = east, π/2 = south
export interface PathSegment { length: number; poseAt(s: number): Pose } // 0 ≤ s ≤ length
export interface RouteStep { pieceId: string; from: number; to: number } // enter at connector from, leave at to
export interface Route { steps: RouteStep[]; closed: boolean }
