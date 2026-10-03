import type { Pose } from '../model/types';

/**
 * Train motion along a closed loop.
 *
 * This module is pure and deterministic: it has no DOM, canvas or timer
 * dependencies, and given the same inputs it always produces the same outputs.
 * A later issue builds a `TrackPath` from real track and draws the result.
 */

/**
 * A closed path the train can run along. `length` is the loop length in cells
 * and `poseAt` gives the pose at arc position `s`. The train always wraps `s`
 * into `[0, length)` before calling `poseAt`, so implementations may assume a
 * non-negative `s` inside the loop and do not need to wrap themselves.
 */
export interface TrackPath {
  readonly length: number;
  poseAt(s: number): Pose;
}

/** Bounded acceleration, in cells per second squared. */
export const TRAIN_ACCEL = 0.8;

/**
 * Longest simulation step the train will take, in seconds. A backgrounded tab
 * can hand us a huge `dt`; clamping it keeps the train from jumping.
 */
export const MAX_STEP_DT = 0.1;

/** Slider position the speed control starts at. */
export const DEFAULT_SPEED_SLIDER = 0.4;

const MIN_SPEED = 0.5;
const MAX_SPEED = 4;

export interface TrainOptions {
  /** Number of carriages behind the engine. Defaults to 2. */
  carriages?: number;
  /** Length of each car, in cells. Defaults to 0.8. */
  carLength?: number;
  /** Gap between consecutive cars, in cells. Defaults to 0.12. */
  gap?: number;
}

export interface TrainState {
  /**
   * Arc position of the train's head (the front of the engine) along the path.
   * Always kept inside `[0, path.length)` by `stepTrain`.
   */
  s: number;
  /** Current speed in cells per second; never negative. */
  v: number;
  /** Whether the train is trying to move. */
  running: boolean;
  /** Number of carriages behind the engine. */
  carriages: number;
  /** Length of each car, in cells. */
  carLength: number;
  /** Gap between consecutive cars, in cells. */
  gap: number;
}

/** Wrap an arc position into `[0, length)`. */
function wrap(s: number, length: number): number {
  if (!(length > 0)) return 0;
  const value = s % length;
  return value < 0 ? value + length : value;
}

/** Clamp a step to `[0, MAX_STEP_DT]`; non-positive or non-finite steps do nothing. */
function clampDt(dt: number): number {
  if (!(dt > 0)) return 0;
  return dt < MAX_STEP_DT ? dt : MAX_STEP_DT;
}

/** Create a stopped train. */
export function createTrain(options: TrainOptions = {}): TrainState {
  return {
    s: 0,
    v: 0,
    running: false,
    carriages: options.carriages ?? 2,
    carLength: options.carLength ?? 0.8,
    gap: options.gap ?? 0.12,
  };
}

/** Set the train running. It pulls away on the next `stepTrain`. */
export function startTrain(state: TrainState): TrainState {
  state.running = true;
  return state;
}

/** Stop the train. It eases to a halt on the next `stepTrain`. */
export function stopTrain(state: TrainState): TrainState {
  state.running = false;
  return state;
}

/**
 * Advance the train by `dt` seconds along `path`.
 *
 * While running the train eases towards `targetSpeed`; when stopped it eases
 * towards zero. Speed is changed by at most `TRAIN_ACCEL * dt`, and is never
 * allowed to go negative, so the train never reverses. The step is clamped to
 * `MAX_STEP_DT`. `stepTrain` mutates `state` in place, so a game loop allocates
 * nothing, and returns it for convenience.
 */
export function stepTrain(
  state: TrainState,
  path: TrackPath,
  dt: number,
  targetSpeed = 0,
): TrainState {
  const step = clampDt(dt);
  if (step === 0 || !(path.length > 0)) return state;

  const target = state.running ? Math.max(0, targetSpeed) : 0;
  const maxDelta = TRAIN_ACCEL * step;

  let delta = target - state.v;
  if (delta > maxDelta) delta = maxDelta;
  else if (delta < -maxDelta) delta = -maxDelta;

  state.v += delta;
  if (state.v < 0) state.v = 0;

  state.s = wrap(state.s + state.v * step, path.length);
  return state;
}

/**
 * Map slider position `t` in `0..1` onto `0.5..4` cells/s along a gentle
 * smoothstep curve. Values outside the range are clamped.
 */
export function speedFromSlider(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const eased = u * u * (3 - 2 * u);
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * eased;
}

/**
 * Poses for the engine followed by each carriage. Every car rests on a front
 * and a rear bogie point `carLength` apart along the path; its pose is the
 * midpoint of those points, and its heading points from rear to front, so cars
 * sit naturally when they straddle a curve.
 */
export function carPoses(state: TrainState, path: TrackPath): Pose[] {
  const count = state.carriages + 1;
  const stride = state.carLength + state.gap;
  const length = path.length;
  const poses: Pose[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const frontS = wrap(state.s - i * stride, length);
    const rearS = wrap(frontS - state.carLength, length);
    const front = path.poseAt(frontS);
    const rear = path.poseAt(rearS);

    const dx = front.x - rear.x;
    const dy = front.y - rear.y;
    poses[i] = {
      x: (front.x + rear.x) / 2,
      y: (front.y + rear.y) / 2,
      heading: dx === 0 && dy === 0 ? front.heading : Math.atan2(dy, dx),
    };
  }

  return poses;
}
