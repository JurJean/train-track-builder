import { describe, expect, it } from 'vitest';
import type { PathSegment, Point, Pose, RouteStep } from '../model/types';
import {
  MAX_STEP_DT,
  TRAIN_ACCEL,
  carPoses,
  createTrain,
  startTrain,
  stepTrain,
} from './train';
import type { TrackPath } from './train';
import {
  EMERGENCY_ACCEL,
  END_CLEARANCE,
  REVERSE_PAUSE,
  createRailTrain,
  frontPose,
  frontStep,
  occupiedPieces,
  railCarPoses,
  railTrainLength,
  startRailTrain,
  stepRailTrain,
  stopRailTrain,
} from './rail-train';
import type { RailTrainState, TrackWalker } from './rail-train';

// --- Synthetic segments and walkers ------------------------------------------

const DT = 1 / 60;

function line(a: Point, b: Point): PathSegment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  return {
    length,
    poseAt(s: number): Pose {
      const t = length === 0 ? 0 : s / length;
      return { x: a.x + dx * t, y: a.y + dy * t, heading };
    },
  };
}

/** Arc around `center`, starting at angle `start`, turning by `sweep` radians. */
function arc(center: Point, radius: number, start: number, sweep: number): PathSegment {
  const length = Math.abs(sweep) * radius;
  const sign = sweep < 0 ? -1 : 1;
  return {
    length,
    poseAt(s: number): Pose {
      const phi = start + sweep * (length === 0 ? 0 : s / length);
      return {
        x: center.x + radius * Math.cos(phi),
        y: center.y + radius * Math.sin(phi),
        heading: Math.atan2(sign * Math.cos(phi), -sign * Math.sin(phi)),
      };
    },
  };
}

/** The same segment run the other way round. */
function backward(seg: PathSegment): PathSegment {
  return {
    length: seg.length,
    poseAt(s: number): Pose {
      const p = seg.poseAt(seg.length - s);
      let heading = p.heading + Math.PI;
      if (heading > Math.PI) heading -= 2 * Math.PI;
      return { x: p.x, y: p.y, heading };
    },
  };
}

/** A step through `id` in its stored orientation. */
function fwd(id: string): RouteStep {
  return { pieceId: id, from: 0, to: 1 };
}

/** A step through `id` the other way round. */
function back(id: string): RouteStep {
  return { pieceId: id, from: 1, to: 0 };
}

/**
 * A walker over named segments. `link(id, forward)` names the piece beyond
 * `id` in the given direction, or null for a dead end; closures over mutable
 * state it models turnouts that can be thrown while the train runs.
 */
function walker(
  pieces: Record<string, PathSegment>,
  link: (id: string, forward: boolean) => string | null,
): TrackWalker {
  const flipped = new Map<string, PathSegment>();
  return {
    next(step: RouteStep): RouteStep | null {
      const forward = step.from === 0 && step.to === 1;
      const id = link(step.pieceId, forward);
      if (id === null) return null;
      return forward ? fwd(id) : back(id);
    },
    segment(step: RouteStep): PathSegment {
      const seg = pieces[step.pieceId];
      if (!seg) throw new Error(`walker: unknown piece ${step.pieceId}`);
      if (step.from === 0 && step.to === 1) return seg;
      if (step.from !== 1 || step.to !== 0) throw new Error('walker: bad connectors');
      let rev = flipped.get(step.pieceId);
      if (!rev) {
        rev = backward(seg);
        flipped.set(step.pieceId, rev);
      }
      return rev;
    },
  };
}

/** A closed circular loop of `count` arc pieces, radius `radius`, plus its walker. */
function circleLoop(count: number, radius: number): {
  segments: PathSegment[];
  walker: TrackWalker;
  steps: RouteStep[];
} {
  const sweep = (2 * Math.PI) / count;
  const segments: PathSegment[] = [];
  const pieces: Record<string, PathSegment> = {};
  const steps: RouteStep[] = [];
  for (let i = 0; i < count; i += 1) {
    const seg = arc({ x: 0, y: 0 }, radius, i * sweep, sweep);
    segments.push(seg);
    pieces[`c${i}`] = seg;
    steps.push(fwd(`c${i}`));
  }
  return {
    segments,
    steps,
    walker: walker(pieces, (id, forward) => {
      const i = Number(id.slice(1));
      const j = forward ? (i + 1) % count : (i + count - 1) % count;
      return `c${j}`;
    }),
  };
}

/** The equivalent fixed closed `TrackPath` over the same segments. */
function loopPath(segments: PathSegment[]): TrackPath {
  const cum = [0];
  for (const seg of segments) cum.push(cum[cum.length - 1] + seg.length);
  const total = cum[cum.length - 1];
  return {
    length: total,
    poseAt(s: number): Pose {
      let t = s % total;
      if (t < 0) t += total;
      let i = 0;
      while (i < segments.length - 1 && t >= cum[i + 1]) i += 1;
      return segments[i].poseAt(t - cum[i]);
    },
  };
}

/** A straight along y = 0 from `x0` to `x1`. */
function straight(id: string, x0: number, x1: number): Record<string, PathSegment> {
  return { [id]: line({ x: x0, y: 0 }, { x: x1, y: 0 }) };
}

/** Smallest angle between two headings. */
function headingDiff(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Step until the train stands still (or the guard runs out); returns frames used. */
function runToRest(state: RailTrainState, w: TrackWalker, target: number): number {
  let frames = 0;
  while (frames < 60 * 60) {
    stepRailTrain(state, w, DT, target);
    frames += 1;
    if (state.v === 0 && frames > 2) break;
  }
  return frames;
}

// --- create -------------------------------------------------------------------

describe('createRailTrain', () => {
  const pieces = { ...straight('s0', -10, 0), ...straight('s1', 0, 6) };
  const w = walker(pieces, (id, forward) => {
    if (forward) return id === 's0' ? 's1' : null;
    return id === 's1' ? 's0' : null;
  });

  it('takes the same options as createTrain and starts stopped', () => {
    const state = createRailTrain([fwd('s0')], w);
    expect(state.carriages).toBe(2);
    expect(state.carLength).toBe(0.8);
    expect(state.gap).toBe(0.12);
    expect(state.v).toBe(0);
    expect(state.running).toBe(false);
    expect(state.reversed).toBe(false);
    expect(railTrainLength(state)).toBeCloseTo(0.8 + 2 * 0.92, 12);
  });

  it('puts the front at the end of the last step', () => {
    const state = createRailTrain([fwd('s0')], w);
    expect(frontStep(state)).toEqual(fwd('s0'));
    expect(frontPose(state).x).toBeCloseTo(0, 12);
    expect(state.frontS).toBeCloseTo(10, 12);
  });

  it('throws a clear error when the steps do not cover the train', () => {
    const short = walker(straight('t', 0, 1), () => null);
    expect(() => createRailTrain([fwd('t')], short)).toThrowError(/cover 1 .*needs 2.64/);
    expect(() => createRailTrain([], short)).toThrowError(/at least one step/);
  });

  it('starts the engine ahead of the carriages, all facing along the track', () => {
    const state = createRailTrain([fwd('s0')], w);
    const poses = railCarPoses(state, w);
    expect(poses).toHaveLength(3);
    expect(poses[0].x).toBeGreaterThan(poses[1].x);
    expect(poses[1].x).toBeGreaterThan(poses[2].x);
    for (const pose of poses) {
      expect(headingDiff(pose.heading, 0)).toBeLessThan(1e-12);
    }
  });
});

// --- Parity with the fixed-loop train -----------------------------------------

describe('parity with carPoses on a closed loop', () => {
  for (const target of [0.5, 2, 4]) {
    it(`matches pose for pose over 1000 steps at target speed ${target}`, () => {
      const loop = circleLoop(8, 2);
      const path = loopPath(loop.segments);

      const rail = createRailTrain(loop.steps, loop.walker, { carriages: 2 });
      startRailTrain(rail);
      const classic = createTrain({ carriages: 2 });
      startTrain(classic);

      for (let i = 0; i < 1000; i += 1) {
        stepRailTrain(rail, loop.walker, DT, target);
        stepTrain(classic, path, DT, target);
        expect(rail.v).toBe(classic.v);

        const a = railCarPoses(rail, loop.walker);
        const b = carPoses(classic, path);
        expect(a).toHaveLength(b.length);
        for (let j = 0; j < a.length; j += 1) {
          expect(Math.abs(a[j].x - b[j].x)).toBeLessThan(1e-6);
          expect(Math.abs(a[j].y - b[j].y)).toBeLessThan(1e-6);
          expect(headingDiff(a[j].heading, b[j].heading)).toBeLessThan(1e-6);
        }
      }
    });
  }
});

// --- Choosing the next piece ---------------------------------------------------

describe('route choice', () => {
  // lead → junction piece `a`; beyond `a` a mutable junction picks `straight`
  // or `curve`, each continuing far away so no dead end interferes.
  function junctionTrack() {
    const pieces: Record<string, PathSegment> = {
      ...straight('lead', -6, 0),
      ...straight('a', 0, 4),
      ...straight('straight', 4, 8),
      curve: arc({ x: 4, y: 4 }, 4, -Math.PI / 2, Math.PI / 2), // (4,0) → (8,4)
      ...straight('s2', 8, 60),
      c2: line({ x: 8, y: 4 }, { x: 8, y: 56 }), // leaves the curve tangentially, south
    };
    const state = { junction: 'straight' };
    const w = walker(pieces, (id, forward) => {
      if (!forward) return null;
      if (id === 'lead') return 'a';
      if (id === 'a') return state.junction;
      if (id === 'straight') return 's2';
      if (id === 'curve') return 'c2';
      return null;
    });
    return { w, state };
  }

  it('follows the junction the walker offers before the front gets there', () => {
    const { w, state } = junctionTrack();
    const train = createRailTrain([fwd('lead')], w);
    startRailTrain(train);

    for (let i = 0; i < 30 && frontStep(train).pieceId !== 'a'; i += 1) {
      stepRailTrain(train, w, DT, 2);
    }
    expect(frontStep(train).pieceId).toBe('a');
    expect(frontPose(train).x).toBeLessThan(4);

    state.junction = 'curve'; // thrown while the front is still inside `a`

    let enteredCurve = false;
    for (let i = 0; i < 600 && !enteredCurve; i += 1) {
      stepRailTrain(train, w, DT, 2);
      enteredCurve = frontStep(train).pieceId === 'curve';
    }
    expect(enteredCurve).toBe(true);

    // The front rides the arc: at x = 6 the circle centred on (4,4), r = 4,
    // puts it at y = 4 - sqrt(12).
    let checked = false;
    for (let i = 0; i < 600 && !checked; i += 1) {
      stepRailTrain(train, w, DT, 2);
      const p = frontPose(train);
      if (p.x >= 6 && p.x < 8) {
        expect(p.y).toBeCloseTo(4 - Math.sqrt(16 - (p.x - 4) ** 2), 6);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it('takes the other route when the junction is set from the start', () => {
    const { w, state } = junctionTrack();
    state.junction = 'curve';
    const train = createRailTrain([fwd('lead')], w);
    startRailTrain(train);
    for (let i = 0; i < 600 && frontStep(train).pieceId !== 'curve'; i += 1) {
      stepRailTrain(train, w, DT, 2);
    }
    expect(frontStep(train).pieceId).toBe('curve');
  });

  it('never changes the route once the front has entered the next step', () => {
    const control = junctionTrack();
    const experiment = junctionTrack();

    const a = createRailTrain([fwd('lead')], control.w);
    const b = createRailTrain([fwd('lead')], experiment.w);
    startRailTrain(a);
    startRailTrain(b);

    // Run both until the front has entered `straight` (next(a) consumed).
    let frames = 0;
    while (frames < 600 && frontStep(a).pieceId !== 'straight') {
      stepRailTrain(a, control.w, DT, 2);
      stepRailTrain(b, experiment.w, DT, 2);
      frames += 1;
    }
    expect(frontStep(a).pieceId).toBe('straight');

    // Throw the junction behind the train; it must not move any car.
    experiment.state.junction = 'curve';
    for (let i = 0; i < 120; i += 1) {
      stepRailTrain(a, control.w, DT, 2);
      stepRailTrain(b, experiment.w, DT, 2);
      expect(frontStep(b).pieceId).not.toBe('curve');

      const pa = railCarPoses(a, control.w);
      const pb = railCarPoses(b, experiment.w);
      for (let j = 0; j < pa.length; j += 1) {
        expect(Math.abs(pa[j].x - pb[j].x)).toBeLessThan(1e-12);
        expect(Math.abs(pa[j].y - pb[j].y)).toBeLessThan(1e-12);
        expect(headingDiff(pa[j].heading, pb[j].heading)).toBeLessThan(1e-12);
      }
    }
  });
});

// --- Dead ends -----------------------------------------------------------------

describe('dead ends', () => {
  // Straight from x = -10 to a buffer at x = 10.
  function deadEndTrack() {
    const pieces = {
      ...straight('s0', -10, 0),
      ...straight('s1', 0, 6),
      ...straight('s2', 6, 10),
    };
    const order = ['s0', 's1', 's2'];
    const w = walker(pieces, (id, forward) => {
      const i = order.indexOf(id);
      if (forward) return i + 1 < order.length ? order[i + 1] : null;
      return i - 1 >= 0 ? order[i - 1] : null;
    });
    return w;
  }

  it('brakes smoothly to rest END_CLEARANCE short of the end, never beyond', () => {
    const w = deadEndTrack();
    const train = createRailTrain([fwd('s0')], w);
    startRailTrain(train);

    let previousV = 0;
    let frames = 0;
    let maxX = -Infinity;
    while (frames < 60 * 60) {
      stepRailTrain(train, w, DT, 4);
      frames += 1;
      const x = frontPose(train).x;
      maxX = Math.max(maxX, x);
      expect(x).toBeLessThanOrEqual(10 - END_CLEARANCE + 1e-9);
      expect(Math.abs(train.v - previousV) / DT).toBeLessThanOrEqual(TRAIN_ACCEL + 1e-6);
      previousV = train.v;
      if (train.v === 0 && frames > 10) break;
    }

    expect(train.v).toBe(0);
    expect(maxX).toBeGreaterThan(9); // it really travelled
    expect(frontPose(train).x).toBeCloseTo(10 - END_CLEARANCE, 2);
  });

  it('brakes harder, within 4x TRAIN_ACCEL, for a dead end revealed inside the braking distance', () => {
    const pieces: Record<string, PathSegment> = {};
    for (let i = 0; i < 12; i += 1) {
      Object.assign(pieces, straight(`b${i}`, i * 4, i * 4 + 4));
    }
    let cut: string | null = null; // throw this piece's forward link to a buffer
    const w = walker(pieces, (id, forward) => {
      if (!forward) return null;
      if (id === cut) return null;
      const i = Number(id.slice(1));
      return i + 1 < 12 ? `b${i + 1}` : null;
    });

    const train = createRailTrain([fwd('b0')], w);
    startRailTrain(train);

    // Get up to speed, then reveal a buffer at x = 20: the braking distance at
    // 4 cells/s is 10, and the end is well inside it.
    while (train.v < 3.99) stepRailTrain(train, w, DT, 4);
    expect(frontPose(train).x).toBeGreaterThan(12);
    expect(frontPose(train).x).toBeLessThan(16);
    cut = 'b4';
    expect(20 - frontPose(train).x).toBeLessThan((train.v * train.v) / (2 * TRAIN_ACCEL));

    let previousV = train.v;
    let frames = 0;
    while (train.v > 0 && frames < 60 * 60) {
      stepRailTrain(train, w, DT, 4);
      frames += 1;
      const x = frontPose(train).x;
      expect(x).toBeLessThanOrEqual(20 - END_CLEARANCE + 1e-9);
      const decel = (previousV - train.v) / DT;
      expect(decel).toBeLessThanOrEqual(EMERGENCY_ACCEL + 1e-6);
      previousV = train.v;
    }

    expect(train.v).toBe(0);
    expect(frontPose(train).x).toBeCloseTo(20 - END_CLEARANCE, 2);
  });

  it('stops before the end even when a dead end appears at point-blank range', () => {
    const pieces: Record<string, PathSegment> = {};
    for (let i = 0; i < 12; i += 1) {
      Object.assign(pieces, straight(`b${i}`, i * 4, i * 4 + 4));
    }
    let cut: string | null = null;
    const w = walker(pieces, (id, forward) => {
      if (!forward) return null;
      if (id === cut) return null;
      const i = Number(id.slice(1));
      return i + 1 < 12 ? `b${i + 1}` : null;
    });

    const train = createRailTrain([fwd('b0')], w);
    startRailTrain(train);
    while (train.v < 3.99) stepRailTrain(train, w, DT, 4);
    const x0 = frontPose(train).x;
    cut = `b${Math.floor(x0 / 4)}`; // buffer at the end of the piece the front is on

    const endX = (Math.floor(x0 / 4) + 1) * 4;
    let frames = 0;
    while (train.v > 0 && frames < 60 * 60) {
      stepRailTrain(train, w, DT, 4);
      frames += 1;
      expect(frontPose(train).x).toBeLessThan(endX); // never runs past the end
    }
    expect(train.v).toBe(0);
    expect(frontPose(train).x).toBeCloseTo(endX - END_CLEARANCE, 2);
  });
});

// --- Reversing -----------------------------------------------------------------

describe('reversing at a dead end', () => {
  function deadEndTrack() {
    const pieces = {
      ...straight('s0', -10, 0),
      ...straight('s1', 0, 6),
      ...straight('s2', 6, 10),
    };
    const order = ['s0', 's1', 's2'];
    return walker(pieces, (id, forward) => {
      const i = order.indexOf(id);
      if (forward) return i + 1 < order.length ? order[i + 1] : null;
      return i - 1 >= 0 ? order[i - 1] : null;
    });
  }

  it('rests for REVERSE_PAUSE, then runs back with unchanged car poses', () => {
    const w = deadEndTrack();
    const train = createRailTrain([fwd('s0')], w);
    startRailTrain(train);
    runToRest(train, w, 4);
    expect(train.v).toBe(0);
    expect(train.reversed).toBe(false);

    const restX = frontPose(train).x;
    let frames = 0;
    let before: Pose[] = railCarPoses(train, w);
    while (!train.reversed && frames < 60 * 10) {
      before = railCarPoses(train, w);
      stepRailTrain(train, w, DT, 4);
      frames += 1;
      if (!train.reversed) {
        expect(frontPose(train).x).toBeCloseTo(restX, 9); // stands still while pausing
      }
    }

    expect(train.reversed).toBe(true);
    expect(frames * DT).toBeCloseTo(REVERSE_PAUSE, 1);

    // The flip moves no car: poses are the same the frame it happens.
    const after = railCarPoses(train, w);
    for (let j = 0; j < after.length; j += 1) {
      expect(Math.abs(after[j].x - before[j].x)).toBeLessThan(1e-9);
      expect(Math.abs(after[j].y - before[j].y)).toBeLessThan(1e-9);
      expect(headingDiff(after[j].heading, before[j].heading)).toBeLessThan(1e-9);
    }
    expect(train.pause).toBe(0);
  });

  it('runs back the way it came, engine last but still the engine, cars unturned', () => {
    const w = deadEndTrack();
    const train = createRailTrain([fwd('s0')], w);
    startRailTrain(train);
    runToRest(train, w, 4);
    let guard = 0;
    while (!train.reversed && guard < 60 * 10) {
      stepRailTrain(train, w, DT, 4);
      guard += 1;
    }
    expect(train.reversed).toBe(true);

    let previousX = frontPose(train).x;
    for (let i = 0; i < 120; i += 1) {
      stepRailTrain(train, w, DT, 4);
      const x = frontPose(train).x;
      expect(x).toBeLessThan(previousX); // heading back west
      previousX = x;

      const poses = railCarPoses(train, w);
      expect(poses).toHaveLength(3);
      // Car order is unchanged: the engine trails the carriages it pushes,
      // so it stays the easternmost car, and every car still faces east.
      expect(poses[0].x).toBeGreaterThan(poses[1].x);
      expect(poses[1].x).toBeGreaterThan(poses[2].x);
      for (const pose of poses) {
        expect(headingDiff(pose.heading, 0)).toBeLessThan(1e-9);
      }
    }
    expect(train.reversed).toBe(true);
    expect(train.v).toBeGreaterThan(0);
  });

  it('Stop during the pause keeps it stopped; Start resumes the countdown', () => {
    const w = deadEndTrack();
    const train = createRailTrain([fwd('s0')], w);
    startRailTrain(train);
    runToRest(train, w, 4);

    for (let i = 0; i < 30; i += 1) stepRailTrain(train, w, DT, 4); // half a second in
    stopRailTrain(train);

    const restX = frontPose(train).x;
    for (let i = 0; i < 60 * 4; i += 1) {
      stepRailTrain(train, w, DT, 4);
      expect(train.v).toBe(0);
      expect(train.reversed).toBe(false);
      expect(frontPose(train).x).toBeCloseTo(restX, 12);
    }

    startRailTrain(train);
    let frames = 0;
    while (!train.reversed && frames < 60 * 5) {
      stepRailTrain(train, w, DT, 4);
      frames += 1;
    }
    expect(train.reversed).toBe(true);
    expect(frames * DT).toBeCloseTo(REVERSE_PAUSE, 1);
  });
});

// --- Speed rules ----------------------------------------------------------------

describe('speed rules', () => {
  it('treats a dt above the clamp as exactly the clamp', () => {
    const loopA = circleLoop(8, 2);
    const loopB = circleLoop(8, 2);
    const a = createRailTrain(loopA.steps, loopA.walker);
    const b = createRailTrain(loopB.steps, loopB.walker);
    startRailTrain(a);
    startRailTrain(b);

    for (let i = 0; i < 20; i += 1) {
      stepRailTrain(a, loopA.walker, MAX_STEP_DT, 4);
      stepRailTrain(b, loopB.walker, 5, 4);
    }
    expect(b.v).toBe(a.v);
    expect(b.frontS).toBe(a.frontS);
    expect(railCarPoses(b, loopB.walker)).toEqual(railCarPoses(a, loopA.walker));
  });

  it('ignores non-positive and non-finite steps', () => {
    const loop = circleLoop(8, 2);
    const train = createRailTrain(loop.steps, loop.walker);
    startRailTrain(train);
    for (const dt of [0, -1, Number.NaN]) {
      stepRailTrain(train, loop.walker, dt, 4);
      expect(train.v).toBe(0);
    }
  });

  it('eases to a smooth halt at exactly 0 without going negative', () => {
    const loop = circleLoop(8, 2);
    const train = createRailTrain(loop.steps, loop.walker);
    startRailTrain(train);
    for (let i = 0; i < 400; i += 1) stepRailTrain(train, loop.walker, DT, 4);
    expect(train.v).toBeGreaterThan(1);

    stopRailTrain(train);
    let previousV = train.v;
    let guard = 0;
    while (train.v > 0 && guard < 1000) {
      stepRailTrain(train, loop.walker, DT, 4);
      expect(train.v).toBeGreaterThanOrEqual(0);
      expect((previousV - train.v) / DT).toBeLessThanOrEqual(TRAIN_ACCEL + 1e-9);
      previousV = train.v;
      guard += 1;
    }
    expect(train.v).toBe(0);
  });

  it('never reverses when asked for a negative target speed', () => {
    const loop = circleLoop(8, 2);
    const train = createRailTrain(loop.steps, loop.walker);
    startRailTrain(train);
    const start = frontPose(train);
    for (let i = 0; i < 100; i += 1) {
      stepRailTrain(train, loop.walker, DT, -3);
      expect(train.v).toBeGreaterThanOrEqual(0);
    }
    expect(train.v).toBe(0);
    expect(frontPose(train)).toEqual(start);
  });
});

// --- Bounded memory ---------------------------------------------------------------

describe('bounded step chain', () => {
  it('stores no more than a handful of steps after 10 minutes on a loop', () => {
    const loop = circleLoop(8, 2);
    const train = createRailTrain(loop.steps, loop.walker);
    startRailTrain(train);

    let maxSteps = 0;
    const frames = Math.ceil(600 / MAX_STEP_DT); // 10 minutes of sim time
    for (let i = 0; i < frames; i += 1) {
      stepRailTrain(train, loop.walker, MAX_STEP_DT, 4);
      maxSteps = Math.max(maxSteps, train.steps.length);
    }
    // The chain covers the 2.64-cell train plus at most one segment of slack
    // at each end; segments are 2π·2/8 ≈ 1.571 cells long.
    expect(maxSteps).toBeLessThanOrEqual(5);
    expect(train.steps.length).toBeLessThanOrEqual(5);
    expect(Number.isFinite(frontPose(train).x)).toBe(true);
  });
});

// --- Locking and QA -----------------------------------------------------------------

describe('occupiedPieces / frontStep', () => {
  function track() {
    const pieces: Record<string, PathSegment> = {};
    const order = ['p0', 'p1', 'p2', 'p3'];
    for (let i = 0; i < 4; i += 1) {
      Object.assign(pieces, straight(order[i], i * 4, i * 4 + 4));
    }
    const w = walker(pieces, (id, forward) => {
      const i = order.indexOf(id);
      if (forward) return i + 1 < order.length ? order[i + 1] : null;
      return i - 1 >= 0 ? order[i - 1] : null;
    });
    return w;
  }

  it('reports only the pieces cars actually stand on', () => {
    const w = track();
    const train = createRailTrain([fwd('p0'), fwd('p1')], w);
    // Front at x = 8, rear at 8 - 2.64 = 5.36: wholly on p1.
    expect(occupiedPieces(train)).toEqual(new Set(['p1']));

    startRailTrain(train);
    while (frontPose(train).x < 9) stepRailTrain(train, w, DT, 1);
    expect(frontStep(train)).toEqual(fwd('p2'));
    expect(occupiedPieces(train)).toEqual(new Set(['p1', 'p2']));

    while (frontPose(train).x < 11) stepRailTrain(train, w, DT, 1);
    // Rear is past x = 8 now, so p1 is free again (turnouts could be thrown).
    expect(occupiedPieces(train)).toEqual(new Set(['p2']));
  });

  it('keeps the chain tight around the train', () => {
    const w = track();
    const train = createRailTrain([fwd('p0'), fwd('p1')], w);
    startRailTrain(train);
    for (let i = 0; i < 300; i += 1) stepRailTrain(train, w, DT, 1);
    expect(train.steps.length).toBeLessThanOrEqual(3);
    expect(train.steps.length).toBeGreaterThanOrEqual(1);
  });
});
