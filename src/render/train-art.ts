import type { Point, Pose } from '../model/types';

/**
 * Train art.
 *
 * `drawEngine` and `drawCarriage` paint a wooden toy train in world units
 * (1 = one cell) onto a context the camera has already transformed. Each car's
 * origin is its centre and its heading follows the model convention: 0 points
 * east (+x) and π/2 points south (+y). Everything is drawn with a single
 * rotation about the car's centre — never a scale — so the art can never be
 * stretched, and a car is mirror-symmetric across its long axis so it cannot
 * look mirrored either.
 *
 * The steam helper is deliberately tiny: `createSteam` makes the state,
 * `updateSteam` ages and emits puffs (more of them the faster the engine goes)
 * and `drawSteam` paints the soft fading puffs. Under
 * `prefers-reduced-motion: reduce` the puffs are cleared and nothing is emitted.
 */

/** Overall length of an engine or carriage, in cells. */
export const CAR_LENGTH = 0.8;
/** Overall width of an engine or carriage, in cells. */
export const CAR_WIDTH = 0.45;

/** A muted, cheerful carriage livery. */
export interface CarriageColour {
  body: string;
  roof: string;
  trim: string;
  window: string;
}

/** Carriage liveries, cycled by `colorIndex`. */
export const CARRIAGE_COLOURS: readonly CarriageColour[] = [
  { body: '#c1604f', roof: '#dd8a77', trim: '#7f3629', window: '#f6ecd8' },
  { body: '#3f8a80', roof: '#6db3a7', trim: '#245a53', window: '#f6ecd8' },
  { body: '#c6922f', roof: '#e0b761', trim: '#845f16', window: '#f6ecd8' },
  { body: '#5a76ad', roof: '#8aa1cf', trim: '#374d7d', window: '#f6ecd8' },
  { body: '#6f9448', roof: '#9cbd6e', trim: '#49682b', window: '#f6ecd8' },
  { body: '#96639a', roof: '#b98bbc', trim: '#6a3f70', window: '#f6ecd8' },
];

/** Livery for a carriage, wrapping `colorIndex` into the palette. */
export function carriageColour(colorIndex: number): CarriageColour {
  const count = CARRIAGE_COLOURS.length;
  const index = ((Math.trunc(colorIndex) % count) + count) % count;
  return CARRIAGE_COLOURS[index];
}

// Warm, painted-wood toy palette. The engine is a deep red boiler with a warm
// wooden underframe and cab, plus brass fittings.
const ENGINE = {
  outline: 'rgba(58, 40, 24, 0.5)',
  underframe: '#6d4623',
  underframeTop: '#8a5c31',
  wheel: '#38281a',
  cab: '#b5813f',
  cabRoof: '#d7a662',
  cabLine: '#7c5525',
  boiler: '#a8443a',
  boilerShade: '#7f2f28',
  boilerShine: 'rgba(255, 236, 224, 0.35)',
  smokebox: '#6f2a24',
  brass: '#d5a441',
  brassShade: '#9a7325',
  chimney: '#342d26',
  chimneyTop: '#4f473d',
  beam: '#b23b2e',
  beamStripe: '#f0e4d0',
  glass: '#f4e9d4',
} as const;

const SHADOW: Point = { x: 0.05, y: 0.07 };

/** Where the chimney sits on the engine, in local (unrotated) cells. */
const CHIMNEY_LOCAL: Point = { x: 0.2, y: 0 };

/** Horizontal offset of the chimney from the engine's centre. */
export const CHIMNEY_AT = CHIMNEY_LOCAL.x;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

/** Rotate the context onto a car pose. The only transform applied is rotation. */
function applyPose(ctx: CanvasRenderingContext2D, pose: Pose): void {
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.heading);
}

/**
 * A soft drop shadow. It is offset in world space (so the light always falls the
 * same way, whatever the car's heading) and rotated with the car, so the shadow
 * silhouette matches the body exactly.
 */
function drawCarShadow(ctx: CanvasRenderingContext2D, pose: Pose): void {
  const halfLength = CAR_LENGTH / 2 + 0.05;
  const halfWidth = CAR_WIDTH / 2 + 0.05;

  ctx.save();
  ctx.translate(pose.x + SHADOW.x, pose.y + SHADOW.y);
  ctx.rotate(pose.heading);

  ctx.fillStyle = 'rgba(54, 40, 25, 0.06)';
  roundedRect(
    ctx,
    -halfLength - 0.025,
    -halfWidth - 0.025,
    (halfLength + 0.025) * 2,
    (halfWidth + 0.025) * 2,
    halfWidth,
  );
  ctx.fill();

  ctx.fillStyle = 'rgba(54, 40, 25, 0.12)';
  roundedRect(ctx, -halfLength, -halfWidth, halfLength * 2, halfWidth * 2, halfWidth);
  ctx.fill();

  ctx.restore();
}

function drawWheels(ctx: CanvasRenderingContext2D, axles: readonly number[], radius: number): void {
  ctx.fillStyle = ENGINE.wheel;
  for (const x of axles) {
    for (const y of [-0.205, 0.205]) {
      circle(ctx, x, y, radius);
      ctx.fill();
    }
  }
}

function drawUnderframe(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = ENGINE.underframe;
  roundedRect(ctx, -0.39, -0.215, 0.78, 0.43, 0.1);
  ctx.fill();
  ctx.fillStyle = ENGINE.underframeTop;
  roundedRect(ctx, -0.375, -0.2, 0.75, 0.4, 0.09);
  ctx.fill();
}

function drawEngineBody(ctx: CanvasRenderingContext2D): void {
  drawWheels(ctx, [-0.26, -0.04, 0.18], 0.05);
  drawUnderframe(ctx);

  // Cab at the rear: a wooden box with a lighter roof and a roof hatch.
  ctx.fillStyle = ENGINE.cab;
  roundedRect(ctx, -0.38, -0.19, 0.3, 0.38, 0.07);
  ctx.fill();
  ctx.fillStyle = ENGINE.cabRoof;
  roundedRect(ctx, -0.355, -0.165, 0.25, 0.33, 0.055);
  ctx.fill();
  ctx.strokeStyle = ENGINE.cabLine;
  ctx.lineWidth = 0.014;
  roundedRect(ctx, -0.32, -0.05, 0.16, 0.1, 0.03);
  ctx.stroke();
  ctx.fillStyle = ENGINE.glass;
  roundedRect(ctx, -0.305, -0.15, 0.11, 0.04, 0.018);
  ctx.fill();
  roundedRect(ctx, -0.305, 0.11, 0.11, 0.04, 0.018);
  ctx.fill();

  // Boiler at the front: a long deep-red pill with a shine and a brass band.
  ctx.fillStyle = ENGINE.boiler;
  roundedRect(ctx, -0.1, -0.16, 0.42, 0.32, 0.155);
  ctx.fill();
  ctx.fillStyle = ENGINE.boilerShine;
  roundedRect(ctx, -0.075, -0.145, 0.36, 0.05, 0.025);
  ctx.fill();
  ctx.fillStyle = ENGINE.brass;
  ctx.fillRect(0.07, -0.16, 0.024, 0.32);

  // Smokebox door on the nose, ringed in brass.
  ctx.fillStyle = ENGINE.smokebox;
  circle(ctx, 0.285, 0, 0.11);
  ctx.fill();
  ctx.fillStyle = ENGINE.boilerShade;
  circle(ctx, 0.285, 0, 0.078);
  ctx.fill();
  ctx.strokeStyle = ENGINE.brass;
  ctx.lineWidth = 0.016;
  circle(ctx, 0.285, 0, 0.11);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.285, -0.05);
  ctx.lineTo(0.285, 0.05);
  ctx.stroke();

  // Steam dome.
  ctx.fillStyle = ENGINE.brass;
  circle(ctx, 0.0, 0, 0.058);
  ctx.fill();
  ctx.fillStyle = ENGINE.brassShade;
  circle(ctx, 0.0, 0, 0.03);
  ctx.fill();

  // Chimney.
  ctx.fillStyle = ENGINE.chimney;
  circle(ctx, CHIMNEY_LOCAL.x, 0, 0.07);
  ctx.fill();
  ctx.fillStyle = ENGINE.chimneyTop;
  circle(ctx, CHIMNEY_LOCAL.x, 0, 0.043);
  ctx.fill();
  ctx.strokeStyle = ENGINE.brass;
  ctx.lineWidth = 0.017;
  circle(ctx, CHIMNEY_LOCAL.x, 0, 0.07);
  ctx.stroke();

  // Buffer beam across the nose.
  ctx.fillStyle = ENGINE.beam;
  roundedRect(ctx, 0.355, -0.17, 0.038, 0.34, 0.016);
  ctx.fill();
  ctx.fillStyle = ENGINE.beamStripe;
  ctx.fillRect(0.355, -0.055, 0.038, 0.028);
  ctx.fillRect(0.355, 0.027, 0.038, 0.028);

  // Painted outline ties the toy together.
  ctx.strokeStyle = ENGINE.outline;
  ctx.lineWidth = 0.018;
  roundedRect(ctx, -0.39, -0.215, 0.78, 0.43, 0.1);
  ctx.stroke();
}

function drawCarriageBody(ctx: CanvasRenderingContext2D, colour: CarriageColour): void {
  drawWheels(ctx, [-0.22, 0.22], 0.055);
  drawUnderframe(ctx);

  // Body and roof.
  ctx.fillStyle = colour.body;
  roundedRect(ctx, -0.375, -0.195, 0.75, 0.39, 0.09);
  ctx.fill();
  ctx.fillStyle = colour.roof;
  roundedRect(ctx, -0.34, -0.15, 0.68, 0.3, 0.07);
  ctx.fill();

  // Roof ridge and end panels.
  ctx.strokeStyle = colour.trim;
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.moveTo(-0.33, 0);
  ctx.lineTo(0.33, 0);
  ctx.stroke();
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(-0.352, -0.18);
  ctx.lineTo(-0.352, 0.18);
  ctx.moveTo(0.352, -0.18);
  ctx.lineTo(0.352, 0.18);
  ctx.stroke();

  // A row of little windows along each side of the roof.
  ctx.fillStyle = colour.window;
  for (const x of [-0.27, -0.09, 0.09, 0.27]) {
    roundedRect(ctx, x - 0.055, -0.135, 0.11, 0.045, 0.018);
    ctx.fill();
    roundedRect(ctx, x - 0.055, 0.09, 0.11, 0.045, 0.018);
    ctx.fill();
  }

  ctx.strokeStyle = ENGINE.outline;
  ctx.lineWidth = 0.016;
  roundedRect(ctx, -0.375, -0.195, 0.75, 0.39, 0.09);
  ctx.stroke();
}

/** Draw the engine at `pose` (its centre, in world units). */
export function drawEngine(ctx: CanvasRenderingContext2D, pose: Pose): void {
  ctx.save();
  drawCarShadow(ctx, pose);
  applyPose(ctx, pose);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawEngineBody(ctx);
  ctx.restore();
}

/** Draw a carriage at `pose` (its centre, in world units) in livery `colorIndex`. */
export function drawCarriage(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  colorIndex: number,
): void {
  ctx.save();
  drawCarShadow(ctx, pose);
  applyPose(ctx, pose);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawCarriageBody(ctx, carriageColour(colorIndex));
  ctx.restore();
}

// --- steam -----------------------------------------------------------------

export interface SteamPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
}

export interface Steam {
  puffs: SteamPuff[];
  /** Fractional puffs waiting to be emitted. */
  accumulator: number;
  /** Total puffs emitted since the state was created (handy for tests and QA). */
  emitted: number;
}

/** Idle puffs per second, before the speed bonus is added. */
export const STEAM_IDLE_RATE = 2.5;
/** Extra puffs per second for each cell per second of speed. */
export const STEAM_SPEED_RATE = 7;

/** Media query that turns the steam off. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the user has asked for reduced motion. Safe without a DOM. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Fresh, empty steam state. */
export function createSteam(): Steam {
  return { puffs: [], accumulator: 0, emitted: 0 };
}

/** World position of the chimney for an engine pose. */
export function chimneyPoint(pose: Pose): Point {
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  return {
    x: pose.x + CHIMNEY_LOCAL.x * cos - CHIMNEY_LOCAL.y * sin,
    y: pose.y + CHIMNEY_LOCAL.x * sin + CHIMNEY_LOCAL.y * cos,
  };
}

function spawnPuff(pose: Pose, speed: number): SteamPuff {
  const at = chimneyPoint(pose);
  const spread = 0.015 + Math.min(0.03, Math.max(0, speed) * 0.012);
  const back = 0.05 + Math.min(0.12, Math.max(0, speed) * 0.05);
  return {
    x: at.x + (Math.random() - 0.5) * spread,
    y: at.y + (Math.random() - 0.5) * spread,
    // Trail behind the engine, then drift up the screen (top-down "rise").
    vx: -Math.cos(pose.heading) * back + (Math.random() - 0.5) * 0.06,
    vy: -Math.sin(pose.heading) * back - (0.18 + Math.random() * 0.12),
    age: 0,
    life: 0.9 + Math.random() * 0.5,
    radius: 0.06 + Math.random() * 0.035,
  };
}

/**
 * Pure steam step. `dt` is in seconds; `reduced` mirrors
 * `prefers-reduced-motion`. `emit` may be turned off to let the puffs already
 * in the air fade out without producing new ones (the board stops animating
 * once the train is parked). Exported so the aging and emission rules can be
 * unit tested without a DOM.
 */
export function stepSteam(
  steam: Steam,
  dt: number,
  enginePose: Pose,
  speed: number,
  reduced: boolean,
  emit = true,
): void {
  if (reduced) {
    steam.puffs.length = 0;
    steam.accumulator = 0;
    return;
  }

  const step = Math.max(0, Math.min(dt, 0.05));
  if (step === 0) return;

  const alive: SteamPuff[] = [];
  for (const puff of steam.puffs) {
    puff.age += step;
    if (puff.age >= puff.life) continue;
    puff.x += puff.vx * step;
    puff.y += puff.vy * step;
    puff.vx *= 0.98;
    puff.vy *= 0.98;
    alive.push(puff);
  }
  steam.puffs = alive;

  if (!emit) return;

  const rate = STEAM_IDLE_RATE + Math.max(0, speed) * STEAM_SPEED_RATE;
  steam.accumulator += rate * step;
  while (steam.accumulator >= 1) {
    steam.accumulator -= 1;
    steam.puffs.push(spawnPuff(enginePose, speed));
    steam.emitted += 1;
  }
}

/**
 * Age steam puffs and (unless `emit` is false) release new ones. Clears and
 * stops under reduced motion.
 */
export function updateSteam(
  steam: Steam,
  dt: number,
  enginePose: Pose,
  speed: number,
  emit = true,
): void {
  stepSteam(steam, dt, enginePose, speed, prefersReducedMotion(), emit);
}

/** Draw the current steam puffs as soft, fading circles. */
export function drawSteam(ctx: CanvasRenderingContext2D, steam: Steam): void {
  if (steam.puffs.length === 0) return;
  ctx.save();
  for (const puff of steam.puffs) {
    const t = Math.min(1, puff.age / puff.life);
    const alpha = Math.pow(1 - t, 1.1) * 0.95;
    if (alpha <= 0.002) continue;
    const radius = puff.radius * (0.9 + t * 2.2);
    const gradient = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, radius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
    gradient.addColorStop(0.6, `rgba(221, 229, 239, ${(alpha * 0.9).toFixed(3)})`);
    gradient.addColorStop(0.85, `rgba(195, 207, 221, ${(alpha * 0.35).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(188, 201, 216, 0)');
    ctx.fillStyle = gradient;
    circle(ctx, puff.x, puff.y, radius);
    ctx.fill();
  }
  ctx.restore();
}
