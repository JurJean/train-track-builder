import type { PathSegment, Pose, RouteStep } from '../model/types';
import { MAX_STEP_DT, TRAIN_ACCEL, speedFromSlider } from './train';
import type { TrainOptions } from './train';

export { speedFromSlider };

/**
 * Train motion along live track, one piece at a time.
 *
 * Unlike `train.ts`, which runs the train around one fixed closed loop by arc
 * length, this module resolves the route as it goes: the front asks a
 * `TrackWalker` for the next step only when it actually crosses into it, so a
 * turnout thrown while the train runs takes effect, and steps the train has
 * already entered never change under it. Dead ends are looked ahead of, braked
 * for and — after a pause — the train sets off back the way it came.
 *
 * This module is pure and deterministic: no DOM, canvas or timers, and given
 * the same inputs it always produces the same outputs.
 */

/**
 * Resolves the route ahead of a running train. The turnouts work adds a
 * `createWalker` in `src/model` with exactly this shape; tests can build
 * synthetic walkers straight from line and arc segments.
 */
export interface TrackWalker {
  /** The step after `step`, continuing the same way; null at a dead end. */
  next(step: RouteStep): RouteStep | null;
  /** Geometry of `step`, oriented from its `from` connector to its `to`. */
  segment(step: RouteStep): PathSegment;
}

/** How far short of the end of the track, in cells, the front comes to rest. */
export const END_CLEARANCE = 0.15;

/** Sim time the train stands at a dead end before setting off backwards, in seconds. */
export const REVERSE_PAUSE = 1.5;

/**
 * Strongest braking, in cells per second squared. Reserved for dead ends that
 * appear inside the normal braking distance, e.g. a turnout thrown at the last
 * moment.
 */
export const EMERGENCY_ACCEL = 4 * TRAIN_ACCEL;

/** Slack, in cells or seconds, for treating the front as "at" a dead end. */
const END_EPSILON = 1e-6;

export interface RailTrainState {
  /** The steps the train currently covers, rear to front. */
  steps: RouteStep[];
  /** Oriented geometry of each step, parallel to `steps`. Cached so frames allocate nothing. */
  segments: PathSegment[];
  /** Length of each step in cells, parallel to `steps`. */
  lengths: number[];
  /** Position of the front inside the front step, in cells from its start; always in `(0, length]`. */
  frontS: number;
  /** Current speed in cells per second; never negative. */
  v: number;
  /** Whether the train is trying to move. */
  running: boolean;
  /** True once the train has reversed an odd number of times: the original rear now leads. */
  reversed: boolean;
  /** Number of carriages behind the engine. */
  carriages: number;
  /** Length of each car, in cells. */
  carLength: number;
  /** Gap between consecutive cars, in cells. */
  gap: number;
  /** Sim time spent standing at a dead end while running, in seconds. */
  pause: number;
}

/** Clamp a step to `[0, MAX_STEP_DT]`; non-positive or non-finite steps do nothing. */
function clampDt(dt: number): number {
  if (!(dt > 0)) return 0;
  return dt < MAX_STEP_DT ? dt : MAX_STEP_DT;
}

/** Distance from the front of the engine to the rear of the last carriage, in cells. */
export function railTrainLength(state: RailTrainState): number {
  return state.carLength + state.carriages * (state.carLength + state.gap);
}

/**
 * Create a stopped train standing on `steps` (rear to front), with its front at
 * the end of the last step and the cars behind it. `steps` must cover the
 * train's length; if they don't, throws. The walker is needed up front because
 * only geometry tells how long the steps are.
 */
export function createRailTrain(
  steps: readonly RouteStep[],
  walker: TrackWalker,
  options: TrainOptions = {},
): RailTrainState {
  if (steps.length === 0) {
    throw new Error('createRailTrain: needs at least one step to stand on');
  }

  const carriages = options.carriages ?? 2;
  const carLength = options.carLength ?? 0.8;
  const gap = options.gap ?? 0.12;

  const owned: RouteStep[] = new Array(steps.length);
  const segments: PathSegment[] = new Array(steps.length);
  const lengths: number[] = new Array(steps.length);
  let total = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const segment = walker.segment(steps[i]);
    owned[i] = steps[i];
    segments[i] = segment;
    lengths[i] = segment.length;
    total += segment.length;
  }

  const needed = carLength + carriages * (carLength + gap);
  if (total < needed) {
    throw new Error(
      `createRailTrain: ${steps.length} steps cover ${total} cells ` +
        `but the train needs ${needed}`,
    );
  }

  return {
    steps: owned,
    segments,
    lengths,
    frontS: lengths[lengths.length - 1],
    v: 0,
    running: false,
    reversed: false,
    carriages,
    carLength,
    gap,
    pause: 0,
  };
}

/** Set the train running. It pulls away on the next `stepRailTrain`. */
export function startRailTrain(state: RailTrainState): RailTrainState {
  state.running = true;
  return state;
}

/** Stop the train. It eases to a halt, and any reverse pause is forgotten. */
export function stopRailTrain(state: RailTrainState): RailTrainState {
  state.running = false;
  state.pause = 0;
  return state;
}

/** Arc position of the front, in cells from the rear end of the step chain. */
function frontArcOf(state: RailTrainState): number {
  const { lengths } = state;
  let arc = state.frontS;
  for (let i = 0; i < lengths.length - 1; i += 1) arc += lengths[i];
  return arc;
}

/** Pose at arc position `u`, in cells from the rear end of the step chain. */
function poseAtArc(state: RailTrainState, u: number): Pose {
  const { segments, lengths } = state;
  const last = lengths.length - 1;
  let acc = 0;
  for (let i = 0; i <= last; i += 1) {
    const len = lengths[i];
    if (i === last || u <= acc + len) {
      const s = u - acc;
      return segments[i].poseAt(s < 0 ? 0 : s > len ? len : s);
    }
    acc += len;
  }
  throw new Error('railTrain: pose arc outside the step chain');
}

/** Pose of the leading point of the train (the very front of the engine). For QA and cameras. */
export function frontPose(state: RailTrainState): Pose {
  return poseAtArc(state, frontArcOf(state));
}

/** The step the front of the train is on. For QA. */
export function frontStep(state: RailTrainState): RouteStep {
  return state.steps[state.steps.length - 1];
}

/** Piece ids any car stands on; used to lock turnouts under the train. */
export function occupiedPieces(state: RailTrainState): ReadonlySet<string> {
  const ids = new Set<string>();
  const frontArc = frontArcOf(state);
  const tailArc = frontArc - railTrainLength(state);
  let acc = 0;
  for (let i = 0; i < state.steps.length; i += 1) {
    const len = state.lengths[i];
    if (acc + len > tailArc && acc < frontArc) ids.add(state.steps[i].pieceId);
    acc += len;
  }
  return ids;
}

/**
 * Distance from the front to the end of the track in cells, peeking ahead with
 * `walker.next` without committing to any step. Returns `Infinity` when the
 * track continues at least as far as the train could ever need to look (its
 * braking distance plus the end clearance).
 */
function distanceToEnd(
  state: RailTrainState,
  walker: TrackWalker,
  step: number,
): number {
  const last = state.steps.length - 1;
  // Look ahead for the speed the train could have by the next scan: `v` may
  // still grow by `TRAIN_ACCEL * step` this frame, and the front moves on by
  // `v * step` before the scan repeats. Predicting both keeps the brake on the
  // smooth curve instead of discovering the end a frame late.
  const vNext = state.v + TRAIN_ACCEL * step;
  const lookAhead =
    (vNext * vNext) / (2 * TRAIN_ACCEL) +
    END_CLEARANCE +
    END_EPSILON +
    vNext * step;
  let dist = state.lengths[last] - state.frontS;
  let at = state.steps[last];
  while (dist < lookAhead) {
    const next = walker.next(at);
    if (next === null) return dist;
    dist += walker.segment(next).length;
    at = next;
  }
  return Infinity;
}

/**
 * Move the front `move` cells along the chain. `walker.next` is asked for the
 * step beyond only when — and each time — the front crosses into it, so a
 * turnout thrown before the train gets there counts, and committed steps never
 * change under the train.
 */
function advance(state: RailTrainState, walker: TrackWalker, move: number): void {
  if (!(move > 0)) return;
  const { steps, segments, lengths } = state;
  state.frontS += move;
  let last = steps.length - 1;
  while (state.frontS > lengths[last]) {
    const over = state.frontS - lengths[last];
    const next = walker.next(steps[last]);
    if (next === null) {
      // The track ends right here; braking should have stopped the train
      // short, so treat this as a hard stop at the very end.
      state.frontS = lengths[last];
      state.v = 0;
      return;
    }
    const segment = walker.segment(next);
    steps.push(next);
    segments.push(segment);
    lengths.push(segment.length);
    last += 1;
    state.frontS = over;
  }
}

/** Forget the steps the last car has left, so the chain stays bounded. */
function trim(state: RailTrainState): void {
  const { steps, segments, lengths } = state;
  let tail = frontArcOf(state) - railTrainLength(state);
  while (steps.length > 1 && tail >= lengths[0]) {
    tail -= lengths[0];
    steps.shift();
    segments.shift();
    lengths.shift();
  }
}

/**
 * Turn the train around: the old rear becomes the new front. The step chain is
 * flipped end for end (each step run the other way, `from` and `to` swapped)
 * and its geometry resolved again through the walker. The cars keep their order
 * and the way they face — `railCarPoses` interprets the flipped chain — and the
 * engine stays the engine; it is pushing now.
 */
function flip(state: RailTrainState, walker: TrackWalker): void {
  const { steps } = state;
  const n = steps.length;
  // The rear of the train lies this far into the rear step; the invariant kept
  // by `trim` puts it inside that step.
  const tailArc = frontArcOf(state) - railTrainLength(state);

  const flipped: RouteStep[] = new Array(n);
  const segments: PathSegment[] = new Array(n);
  const lengths: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const source = steps[n - 1 - i];
    const step: RouteStep = { pieceId: source.pieceId, from: source.to, to: source.from };
    const segment = walker.segment(step);
    flipped[i] = step;
    segments[i] = segment;
    lengths[i] = segment.length;
  }

  state.steps = flipped;
  state.segments = segments;
  state.lengths = lengths;
  // The old rear sat `tailArc` cells into the old rear step, which is now the
  // front step running the other way.
  state.frontS = lengths[n - 1] - tailArc;
  state.reversed = !state.reversed;
  state.pause = 0;
}

/**
 * Advance the train by `dt` seconds along the track `walker` describes.
 *
 * The speed rules match `stepTrain`: the step is clamped to `MAX_STEP_DT`,
 * speed changes by at most `TRAIN_ACCEL * dt` (or `EMERGENCY_ACCEL * dt` when a
 * dead end appears inside the normal braking distance), Stop eases to zero and
 * speed is never negative. On top of that the train brakes along a smooth curve
 * so the front comes to rest exactly `END_CLEARANCE` short of a dead end, never
 * runs past it, and after standing there for `REVERSE_PAUSE` seconds of sim
 * time while running, sets off the other way.
 *
 * Mutates `state` in place and allocates nothing per frame apart from new steps
 * the front crosses into.
 */
export function stepRailTrain(
  state: RailTrainState,
  walker: TrackWalker,
  dt: number,
  targetSpeed = 0,
): RailTrainState {
  const step = clampDt(dt);
  if (step === 0) return state;

  // Look for the end of the track before deciding how fast to go.
  const endDist = distanceToEnd(state, walker, step);
  const target = state.running ? Math.max(0, targetSpeed) : 0;

  let goal = target;
  let accel = TRAIN_ACCEL;
  let room = Infinity;
  if (endDist !== Infinity) {
    room = Math.max(endDist - END_CLEARANCE, 0);
    // Speed from which braking at TRAIN_ACCEL still lands the front exactly on
    // the stopping point: riding this curve decelerates no harder than
    // TRAIN_ACCEL and never overshoots.
    const x = TRAIN_ACCEL * step;
    const vSmooth = Math.sqrt(x * x + 2 * TRAIN_ACCEL * room) - x;
    if (vSmooth < goal) goal = vSmooth;
    // A dead end much closer than the normal braking distance calls for harder
    // braking. The slack of `4·A·v·dt + (A·dt)²` covers the frame of lag
    // between looking ahead and updating the speed, so merely spotting the end
    // in time is never treated as an emergency. With no room left, speed just
    // bleeds off at the normal rate.
    const lag = 4 * TRAIN_ACCEL * state.v * step + TRAIN_ACCEL * TRAIN_ACCEL * step * step;
    if (room > 0 && state.v * state.v > 2 * TRAIN_ACCEL * room + lag + END_EPSILON) {
      accel = EMERGENCY_ACCEL;
    }
  }

  const maxDelta = accel * step;
  let delta = goal - state.v;
  if (delta > maxDelta) delta = maxDelta;
  else if (delta < -maxDelta) delta = -maxDelta;
  state.v += delta;
  if (state.v < 0) state.v = 0;

  let move = state.v * step;
  if (move > room) {
    // Never run past the stopping point. Any speed left over (a buffer that
    // appeared too close to stop for) bleeds off on the following frames: with
    // `room` at zero the smooth-braking curve makes the goal zero, and the
    // delta clamp above limits how fast the speed falls.
    move = room;
  }

  advance(state, walker, move);
  trim(state);

  if (state.v === 0 && endDist <= END_CLEARANCE + END_EPSILON) {
    if (state.running) {
      state.pause += step;
      if (state.pause >= REVERSE_PAUSE) flip(state, walker);
    } else {
      state.pause = 0;
    }
  } else {
    state.pause = 0;
  }
  return state;
}

/**
 * Poses for the engine followed by each carriage, in car order regardless of
 * which way the train runs. As in `carPoses`, every car rests on a front and a
 * rear bogie point `carLength` apart along the track; its pose is the midpoint
 * of those points and its heading points from the car's rear bogie to its front
 * bogie as the car faces, so a reversing train does not spin its cars round.
 */
export function railCarPoses(state: RailTrainState, _walker: TrackWalker): Pose[] {
  const count = state.carriages + 1;
  const stride = state.carLength + state.gap;
  const frontArc = frontArcOf(state);
  const tailArc = frontArc - railTrainLength(state);
  const poses: Pose[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    // Car `i` counts from the engine. Running normally the cars trail behind
    // the front; reversed, the engine sits at the rear of the chain, pushing.
    const frontU = state.reversed ? tailArc + i * stride : frontArc - i * stride;
    const rearU = state.reversed ? frontU + state.carLength : frontU - state.carLength;
    const front = poseAtArc(state, frontU);
    const rear = poseAtArc(state, rearU);

    const dx = front.x - rear.x;
    const dy = front.y - rear.y;
    poses[i] = {
      x: (front.x + rear.x) / 2,
      y: (front.y + rear.y) / 2,
      heading:
        dx === 0 && dy === 0
          ? front.heading + (state.reversed ? Math.PI : 0)
          : Math.atan2(dy, dx),
    };
  }
  return poses;
}
