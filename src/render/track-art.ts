import { PIECES, rotateDef } from '../model/pieces';
import type { LinkShape, PieceKind, PlacedPiece, Point, Rotation } from '../model/types';

export type GhostMode = 'valid' | 'invalid';

export interface DrawPieceOptions {
  /** Draw a placement ghost instead of the solid piece. */
  ghost?: GhostMode;
}

/**
 * Track piece art.
 *
 * `drawPiece` paints one placed piece in world units (1 = one cell) onto a
 * context the camera has already transformed. Every rail is derived from the
 * piece's link shapes, so neighbouring pieces meet exactly and the train can
 * later ride on what is drawn.
 *
 * Rendering is cached: each (kind, rotation, zoom bucket) becomes an offscreen
 * canvas the first time it is needed, so a frame of 1,000 pieces is mostly
 * `drawImage` calls. The invalid-ghost sprite is baked the same way (muted red
 * plus a diagonal hatch), which also keeps ghosts from flashing.
 */

// A calm wooden toy palette: natural sleepers, two rails, warm muted colours.
const COLOUR = {
  shadow: 'rgba(58, 44, 28, 0.20)',
  ballastEdge: '#b9966a',
  ballast: '#cfb083',
  sleeperEdge: '#a97c43',
  sleeper: '#d8ae70',
  railDark: '#8a7d6b',
  railLight: '#e6e0d2',
  stream: '#8fc4e0',
  streamDark: '#6fa8c9',
  streamLight: '#c8e6f3',
  deck: '#cfa96f',
  deckLine: '#ac8148',
  railing: '#9c6f38',
  grassLight: '#b6df90',
  grassDark: '#6f9d47',
  portal: '#3b3127',
  portalArch: '#a08d70',
  platform: '#e0c896',
  platformEdge: '#b99a63',
  shelterWall: '#f1e5cb',
  shelterRoof: '#c05a45',
  bufferRed: '#c0392b',
  bufferWhite: '#f4efe4',
  bufferDark: '#7a2d22',
  ghostTint: 'rgba(196, 92, 84, 0.66)',
  ghostHatch: 'rgba(150, 55, 48, 0.55)',
} as const;

/** World-space margin around a footprint stored in every sprite. */
export const TRACK_ART_MARGIN = 0.55;
/** Distance from the centreline to each rail. */
export const RAIL_GAUGE = 0.17;
/** Distance between sleepers along the track. */
const SLEEPER_SPACING = 0.24;
const SLEEPER_HALF = 0.23;
const SLEEPER_WIDTH = 0.075;
const RAIL_WIDTH = 0.075;
const SHADOW_OFFSET: Point = { x: 0.045, y: 0.065 };
const DEFAULT_SCALE = 32;

/** Zoom buckets, in device pixels per cell, that sprites are rendered for. */
export const CACHE_BUCKETS: readonly number[] = [
  16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256,
];

export interface Sampled {
  point: Point;
  /** Unit tangent in the direction of increasing `s`. */
  tangent: Point;
}

export interface RailPair {
  atA: Point;
  atB: Point;
}

interface ArcInfo {
  center: Point;
  radius: number;
  start: number;
  end: number;
  delta: number;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Smallest cache bucket that is at least `scale` device pixels per cell. */
export function cacheBucket(scale: number): number {
  for (const bucket of CACHE_BUCKETS) {
    if (scale <= bucket) return bucket;
  }
  return CACHE_BUCKETS[CACHE_BUCKETS.length - 1];
}

/** Width and height, in cells, of a piece footprint at a rotation. */
export function pieceFootprintSize(
  kind: PieceKind,
  rotation: Rotation,
): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const cell of rotateDef(kind, rotation).footprint) {
    w = Math.max(w, cell.x + 1);
    h = Math.max(h, cell.y + 1);
  }
  return { w, h };
}

/**
 * The same map `rotateDef` applies to points, exposed for tests (and used to
 * prove the sprite rotation matches `linkShapes`).
 */
export function rotateBasePoint(kind: PieceKind, rotation: Rotation, point: Point): Point {
  let { x, y } = point;
  for (let i = 1; i <= rotation; i += 1) {
    const h = pieceFootprintSize(kind, (i - 1) as Rotation).h;
    const nextX = h - y;
    const nextY = x;
    x = nextX;
    y = nextY;
  }
  return { x, y };
}

function arcInfo(shape: Extract<LinkShape, { type: 'arc' }>): ArcInfo {
  const start = Math.atan2(shape.a.y - shape.center.y, shape.a.x - shape.center.x);
  const end = Math.atan2(shape.b.y - shape.center.y, shape.b.x - shape.center.x);
  let delta = end - start;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return { center: shape.center, radius: shape.radius, start, end, delta };
}

/** Length of a link shape in cells. */
export function shapeLength(shape: LinkShape): number {
  if (shape.type === 'line') {
    return Math.hypot(shape.b.x - shape.a.x, shape.b.y - shape.a.y);
  }
  return Math.abs(arcInfo(shape).delta) * shape.radius;
}

/** A point and unit tangent at position `s` (0..1) along a link shape. */
export function sampleShape(shape: LinkShape, s: number): Sampled {
  if (shape.type === 'line') {
    const dx = shape.b.x - shape.a.x;
    const dy = shape.b.y - shape.a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      point: { x: shape.a.x + dx * s, y: shape.a.y + dy * s },
      tangent: { x: dx / length, y: dy / length },
    };
  }

  const { center, radius, start, delta } = arcInfo(shape);
  const angle = start + delta * s;
  const dir = delta < 0 ? -1 : 1;
  return {
    point: { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) },
    tangent: { x: -Math.sin(angle) * dir, y: Math.cos(angle) * dir },
  };
}

/**
 * The two endpoints of a rail offset `offset` from the centreline. For an arc
 * the rail is concentric; for a line it is parallel. Offsetting both sides and
 * using the same link shape on either side of a join makes the rails meet.
 */
export function railPoints(shape: LinkShape, offset: number): RailPair {
  if (shape.type === 'line') {
    const dx = shape.b.x - shape.a.x;
    const dy = shape.b.y - shape.a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    return {
      atA: { x: shape.a.x + nx * offset, y: shape.a.y + ny * offset },
      atB: { x: shape.b.x + nx * offset, y: shape.b.y + ny * offset },
    };
  }

  const { center, radius } = arcInfo(shape);
  const r = radius + offset;
  const ax = shape.a.x - center.x;
  const ay = shape.a.y - center.y;
  const bx = shape.b.x - center.x;
  const by = shape.b.y - center.y;
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  return {
    atA: { x: center.x + (ax / al) * r, y: center.y + (ay / al) * r },
    atB: { x: center.x + (bx / bl) * r, y: center.y + (by / bl) * r },
  };
}

function strokeShape(ctx: CanvasRenderingContext2D, shape: LinkShape, offset: number): void {
  ctx.beginPath();
  if (shape.type === 'line') {
    const { atA, atB } = railPoints(shape, offset);
    ctx.moveTo(atA.x, atA.y);
    ctx.lineTo(atB.x, atB.y);
  } else {
    const { center, radius, start, end, delta } = arcInfo(shape);
    ctx.arc(center.x, center.y, Math.abs(radius + offset), start, end, delta < 0);
  }
  ctx.stroke();
}

function sleeperPath(ctx: CanvasRenderingContext2D, shape: LinkShape, count: number): void {
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const { point, tangent } = sampleShape(shape, (i + 0.5) / count);
    const nx = -tangent.y;
    const ny = tangent.x;
    ctx.moveTo(point.x - nx * SLEEPER_HALF, point.y - ny * SLEEPER_HALF);
    ctx.lineTo(point.x + nx * SLEEPER_HALF, point.y + ny * SLEEPER_HALF);
  }
}

function drawTrackBase(ctx: CanvasRenderingContext2D, shape: LinkShape): void {
  const width = RAIL_GAUGE * 2 + 0.2;
  ctx.lineCap = 'butt';

  ctx.save();
  ctx.translate(SHADOW_OFFSET.x, SHADOW_OFFSET.y);
  ctx.strokeStyle = COLOUR.shadow;
  ctx.lineWidth = width + 0.22;
  strokeShape(ctx, shape, 0);
  ctx.lineWidth = width + 0.06;
  strokeShape(ctx, shape, 0);
  ctx.restore();

  ctx.strokeStyle = COLOUR.ballastEdge;
  ctx.lineWidth = width + 0.05;
  strokeShape(ctx, shape, 0);
  ctx.strokeStyle = COLOUR.ballast;
  ctx.lineWidth = width;
  strokeShape(ctx, shape, 0);
}

function drawSleepers(ctx: CanvasRenderingContext2D, shape: LinkShape): void {
  const count = Math.max(1, Math.floor(shapeLength(shape) / SLEEPER_SPACING));
  ctx.lineCap = 'butt';
  ctx.strokeStyle = COLOUR.sleeperEdge;
  ctx.lineWidth = SLEEPER_WIDTH + 0.025;
  sleeperPath(ctx, shape, count);
  ctx.stroke();
  ctx.strokeStyle = COLOUR.sleeper;
  ctx.lineWidth = SLEEPER_WIDTH;
  sleeperPath(ctx, shape, count);
  ctx.stroke();
}

function drawRails(ctx: CanvasRenderingContext2D, shape: LinkShape): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLOUR.railDark;
  ctx.lineWidth = RAIL_WIDTH;
  strokeShape(ctx, shape, RAIL_GAUGE);
  strokeShape(ctx, shape, -RAIL_GAUGE);
  ctx.strokeStyle = COLOUR.railLight;
  ctx.lineWidth = RAIL_WIDTH * 0.5;
  strokeShape(ctx, shape, RAIL_GAUGE);
  strokeShape(ctx, shape, -RAIL_GAUGE);
}

function drawTrack(ctx: CanvasRenderingContext2D, shape: LinkShape): void {
  drawTrackBase(ctx, shape);
  drawSleepers(ctx, shape);
  drawRails(ctx, shape);
}

function drawCrossing(ctx: CanvasRenderingContext2D): void {
  const shapes = PIECES.crossing.shapes;
  // Both beds, then both sets of sleepers, then both rails, so the crossing
  // reads as one neat overlap rather than one track sitting on top of another.
  for (const shape of shapes) drawTrackBase(ctx, shape);
  for (const shape of shapes) drawSleepers(ctx, shape);
  for (const shape of shapes) drawRails(ctx, shape);
}

function drawStream(ctx: CanvasRenderingContext2D): void {
  const top = 0.26;
  const height = 0.48;
  ctx.fillStyle = COLOUR.stream;
  ctx.fillRect(0, top, 1, height);
  ctx.fillStyle = COLOUR.streamDark;
  ctx.fillRect(0, top, 1, 0.045);
  ctx.fillRect(0, top + height - 0.045, 1, 0.045);

  ctx.strokeStyle = COLOUR.streamLight;
  ctx.lineWidth = 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 3; i += 1) {
    const y = top + 0.12 + i * 0.12;
    ctx.moveTo(0.04, y);
    ctx.bezierCurveTo(0.32, y - 0.05, 0.68, y + 0.05, 0.96, y);
  }
  ctx.stroke();
}

function drawDeck(ctx: CanvasRenderingContext2D): void {
  const left = 0.13;
  const right = 0.87;
  const width = right - left;

  ctx.fillStyle = COLOUR.shadow;
  ctx.fillRect(left + 0.035, 0.02, width, 0.98);

  ctx.fillStyle = COLOUR.deck;
  ctx.fillRect(left, 0, width, 1);
  ctx.strokeStyle = COLOUR.deckLine;
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let y = 0.12; y < 1; y += 0.14) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.lineWidth = 0.03;
  ctx.strokeRect(left, 0, width, 1);

  // Low railings and their posts run the length of the deck.
  ctx.strokeStyle = COLOUR.railing;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(left + 0.05, 0.04);
  ctx.lineTo(left + 0.05, 0.96);
  ctx.moveTo(right - 0.05, 0.04);
  ctx.lineTo(right - 0.05, 0.96);
  ctx.stroke();
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  for (let y = 0.1; y < 1; y += 0.2) {
    ctx.moveTo(left + 0.02, y);
    ctx.lineTo(left + 0.08, y);
    ctx.moveTo(right - 0.08, y);
    ctx.lineTo(right - 0.02, y);
  }
  ctx.stroke();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function direction(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function portalPath(
  ctx: CanvasRenderingContext2D,
  at: Point,
  inward: Point,
  halfWidth: number,
  depth: number,
): void {
  const tx = -inward.y;
  const ty = inward.x;
  const cx = at.x + inward.x * depth;
  const cy = at.y + inward.y * depth;

  ctx.beginPath();
  ctx.moveTo(at.x + tx * halfWidth, at.y + ty * halfWidth);
  ctx.lineTo(cx + tx * halfWidth, cy + ty * halfWidth);
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const phi = -Math.PI / 2 + (Math.PI * i) / steps;
    const px = cx + tx * (halfWidth * Math.sin(phi)) + inward.x * (halfWidth * Math.cos(phi));
    const py = cy + ty * (halfWidth * Math.sin(phi)) + inward.y * (halfWidth * Math.cos(phi));
    ctx.lineTo(px, py);
  }
  ctx.lineTo(at.x - tx * halfWidth, at.y - ty * halfWidth);
  ctx.closePath();
}

function drawPortal(
  ctx: CanvasRenderingContext2D,
  shape: LinkShape,
  at: Point,
  inward: Point,
): void {
  const halfWidth = 0.2;
  const depth = 0.1;

  portalPath(ctx, at, inward, halfWidth, depth);
  ctx.fillStyle = COLOUR.portal;
  ctx.fill();

  // Rails only exist inside the portal mouth; the hill hides the rest.
  ctx.save();
  portalPath(ctx, at, inward, halfWidth, depth);
  ctx.clip();
  drawRails(ctx, shape);
  ctx.restore();

  portalPath(ctx, at, inward, halfWidth, depth);
  ctx.strokeStyle = COLOUR.portalArch;
  ctx.lineWidth = 0.035;
  ctx.stroke();
}

function drawTunnel(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(0.05, 0.07);
  ctx.fillStyle = COLOUR.shadow;
  roundedRect(ctx, 0.02, 0.02, 0.96, 0.96, 0.32);
  ctx.fill();
  ctx.restore();

  const gradient = ctx.createRadialGradient(0.36, 0.3, 0.05, 0.5, 0.52, 0.8);
  gradient.addColorStop(0, COLOUR.grassLight);
  gradient.addColorStop(1, COLOUR.grassDark);
  ctx.fillStyle = gradient;
  roundedRect(ctx, 0, 0, 1, 1, 0.3);
  ctx.fill();
  ctx.strokeStyle = COLOUR.grassDark;
  ctx.lineWidth = 0.035;
  ctx.stroke();

  const shape = PIECES.tunnel.shapes[0];
  if (shape.type !== 'line') return;
  drawPortal(ctx, shape, shape.a, direction(shape.a, shape.b));
  drawPortal(ctx, shape, shape.b, direction(shape.b, shape.a));
}

function drawShelter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = COLOUR.shadow;
  ctx.fillRect(x + 0.02, y + 0.02, w, h);
  ctx.fillStyle = COLOUR.shelterWall;
  ctx.fillRect(x + 0.02, y + 0.08, w - 0.04, h - 0.12);
  ctx.fillStyle = COLOUR.shelterRoof;
  ctx.fillRect(x, y, w, h * 0.55);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(x + 0.02, y + h * 0.28);
  ctx.lineTo(x + w - 0.02, y + h * 0.28);
  ctx.stroke();
}

function drawStation(ctx: CanvasRenderingContext2D): void {
  const px = 0.05;
  const py = 0.12;
  const pw = 0.2;
  const ph = 1.76;

  ctx.fillStyle = COLOUR.shadow;
  ctx.fillRect(px + 0.03, py + 0.03, pw, ph);
  ctx.fillStyle = COLOUR.platform;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = COLOUR.platformEdge;
  ctx.lineWidth = 0.02;
  ctx.strokeRect(px, py, pw, ph);

  ctx.save();
  ctx.globalAlpha *= 0.6;
  ctx.strokeStyle = COLOUR.platformEdge;
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  for (let y = py + 0.2; y < py + ph; y += 0.22) {
    ctx.moveTo(px, y);
    ctx.lineTo(px + pw, y);
  }
  ctx.stroke();
  ctx.restore();

  drawShelter(ctx, px + 0.01, 0.72, pw - 0.02, 0.42);

  drawTrack(ctx, PIECES.station.shapes[0]);
}

function drawBufferStop(ctx: CanvasRenderingContext2D): void {
  const stub: LinkShape = {
    type: 'line',
    a: { x: 0.5, y: 1 },
    b: { x: 0.5, y: 0.46 },
  };
  drawTrackBase(ctx, stub);
  drawSleepers(ctx, stub);
  drawRails(ctx, stub);

  const cx = 0.5;
  const cy = 0.44;
  const halfWidth = 0.24;
  const height = 0.14;

  ctx.fillStyle = COLOUR.shadow;
  ctx.fillRect(cx - halfWidth + 0.02, cy - height / 2 + 0.03, halfWidth * 2, height);

  const segments = 5;
  const segmentWidth = (halfWidth * 2) / segments;
  for (let i = 0; i < segments; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? COLOUR.bufferRed : COLOUR.bufferWhite;
    ctx.fillRect(cx - halfWidth + i * segmentWidth, cy - height / 2, segmentWidth, height);
  }
  ctx.strokeStyle = COLOUR.bufferDark;
  ctx.lineWidth = 0.02;
  ctx.strokeRect(cx - halfWidth, cy - height / 2, halfWidth * 2, height);

  ctx.fillStyle = COLOUR.bufferDark;
  ctx.fillRect(0.3, 0.5, 0.06, 0.1);
  ctx.fillRect(0.64, 0.5, 0.06, 0.1);
}

function drawBaseArt(ctx: CanvasRenderingContext2D, kind: PieceKind): void {
  switch (kind) {
    case 'straight':
      drawTrack(ctx, PIECES.straight.shapes[0]);
      break;
    case 'curve-sharp':
      drawTrack(ctx, PIECES['curve-sharp'].shapes[0]);
      break;
    case 'curve-gentle':
      drawTrack(ctx, PIECES['curve-gentle'].shapes[0]);
      break;
    case 'crossing':
      drawCrossing(ctx);
      break;
    case 'bridge':
      drawStream(ctx);
      drawDeck(ctx);
      drawTrack(ctx, PIECES.bridge.shapes[0]);
      break;
    case 'tunnel':
      drawTunnel(ctx);
      break;
    case 'station':
      drawStation(ctx);
      break;
    case 'buffer-stop':
      drawBufferStop(ctx);
      break;
  }
}

function applyRotation(
  ctx: CanvasRenderingContext2D,
  kind: PieceKind,
  rotation: Rotation,
): void {
  // Each step is translate(h, 0) then rotate 90deg; applied back-to-front so the
  // first quarter turn is the innermost transform (matching rotateDef).
  for (let i = rotation; i >= 1; i -= 1) {
    const h = pieceFootprintSize(kind, (i - 1) as Rotation).h;
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function tintInvalid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bucket: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';

  ctx.fillStyle = COLOUR.ghostTint;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = COLOUR.ghostHatch;
  ctx.lineWidth = Math.max(1, bucket * 0.03);
  const step = Math.max(5, bucket * 0.18);
  ctx.beginPath();
  for (let d = -height; d < width; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + height, height);
  }
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
}

function renderSprite(
  kind: PieceKind,
  rotation: Rotation,
  bucket: number,
  invalid: boolean,
): HTMLCanvasElement | null {
  const { w, h } = pieceFootprintSize(kind, rotation);
  const width = Math.max(1, Math.ceil((w + TRACK_ART_MARGIN * 2) * bucket));
  const height = Math.max(1, Math.ceil((h + TRACK_ART_MARGIN * 2) * bucket));
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.setTransform(
    bucket,
    0,
    0,
    bucket,
    TRACK_ART_MARGIN * bucket,
    TRACK_ART_MARGIN * bucket,
  );
  applyRotation(ctx, kind, rotation);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawBaseArt(ctx, kind);

  if (invalid) tintInvalid(ctx, width, height, bucket);
  return canvas;
}

function getSprite(
  kind: PieceKind,
  rotation: Rotation,
  bucket: number,
  invalid: boolean,
): HTMLCanvasElement | null {
  const key = `${kind}|${rotation}|${bucket}|${invalid ? 'invalid' : 'normal'}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const sprite = renderSprite(kind, rotation, bucket, invalid);
  if (sprite) spriteCache.set(key, sprite);
  return sprite;
}

/** Drop every cached sprite (used by tests and QA). */
export function clearTrackArtCache(): void {
  spriteCache.clear();
}

function currentScale(ctx: CanvasRenderingContext2D): number {
  try {
    if (typeof ctx.getTransform === 'function') {
      const matrix = ctx.getTransform();
      const scale = Math.hypot(matrix.a, matrix.b);
      if (scale > 0) return scale;
    }
  } catch {
    // Fall through to the default bucket.
  }
  return DEFAULT_SCALE;
}

function drawDirect(
  ctx: CanvasRenderingContext2D,
  piece: PlacedPiece,
  ghost: GhostMode | undefined,
): void {
  ctx.save();
  ctx.translate(piece.origin.x, piece.origin.y);
  applyRotation(ctx, piece.kind, piece.rotation);
  if (ghost === 'valid') ctx.globalAlpha *= 0.55;
  else if (ghost === 'invalid') ctx.globalAlpha *= 0.9;
  drawBaseArt(ctx, piece.kind);
  ctx.restore();
}

/**
 * Draw `piece` in world units on a context the camera has transformed.
 *
 * With `{ ghost: 'valid' }` the piece is drawn translucent; with
 * `{ ghost: 'invalid' }` it is muted red with a diagonal hatch (so validity is
 * never signalled by colour alone).
 */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: PlacedPiece,
  opts: DrawPieceOptions = {},
): void {
  const ghost = opts.ghost;
  const bucket = cacheBucket(currentScale(ctx));
  const { w, h } = pieceFootprintSize(piece.kind, piece.rotation);
  const sprite = getSprite(piece.kind, piece.rotation, bucket, ghost === 'invalid');

  if (sprite) {
    const x = piece.origin.x - TRACK_ART_MARGIN;
    const y = piece.origin.y - TRACK_ART_MARGIN;
    const previousAlpha = ctx.globalAlpha;
    if (ghost === 'valid') ctx.globalAlpha = previousAlpha * 0.55;
    else if (ghost === 'invalid') ctx.globalAlpha = previousAlpha * 0.9;
    ctx.drawImage(
      sprite,
      x,
      y,
      w + TRACK_ART_MARGIN * 2,
      h + TRACK_ART_MARGIN * 2,
    );
    ctx.globalAlpha = previousAlpha;
    return;
  }

  drawDirect(ctx, piece, ghost);
}
