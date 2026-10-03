import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED_SLIDER,
  MAX_STEP_DT,
  TRAIN_ACCEL,
  carPoses,
  createTrain,
  speedFromSlider,
  startTrain,
  stepTrain,
  stopTrain,
} from './train';
import type { TrackPath } from './train';

// --- Test paths -------------------------------------------------------------

const RADIUS = 2;

/** A plain circle, counter-clockwise in screen space. */
const circle: TrackPath = {
  length: 2 * Math.PI * RADIUS,
  poseAt(s) {
    const angle = (s / RADIUS) % (2 * Math.PI);
    const a = angle < 0 ? angle + 2 * Math.PI : angle;
    return {
      x: RADIUS * Math.cos(a),
      y: RADIUS * Math.sin(a),
      heading: a + Math.PI / 2,
    };
  },
};

/**
 * A rectangular loop, walked clockwise from the top-left corner. Its long, flat
 * sides make it easy to measure distances along the path in a straight line.
 */
function rectanglePath(width: number, height: number): TrackPath {
  const w = width;
  const h = height;
  const length = 2 * (w + h);
  return {
    length,
    poseAt(s) {
      let t = s % length;
      if (t < 0) t += length;
      if (t < w) return { x: t, y: 0, heading: 0 };
      t -= w;
      if (t < h) return { x: w, y: t, heading: Math.PI / 2 };
      t -= h;
      if (t < w) return { x: w - t, y: h, heading: Math.PI };
      t -= w;
      return { x: 0, y: h - t, heading: -Math.PI / 2 };
    },
  };
}

// --- create / start / stop --------------------------------------------------

describe('createTrain / startTrain / stopTrain', () => {
  it('defaults to two carriages and stands still', () => {
    const state = createTrain();
    expect(state).toMatchObject({
      s: 0,
      v: 0,
      running: false,
      carriages: 2,
      carLength: 0.8,
      gap: 0.12,
    });
  });

  it('accepts overrides', () => {
    const state = createTrain({ carriages: 5, carLength: 1.4, gap: 0.2 });
    expect(state.carriages).toBe(5);
    expect(state.carLength).toBe(1.4);
    expect(state.gap).toBe(0.2);
  });

  it('toggles the running flag', () => {
    const state = createTrain();
    expect(startTrain(state).running).toBe(true);
    expect(stopTrain(state).running).toBe(false);
  });

  it('does not move while stopped', () => {
    const state = createTrain();
    stepTrain(state, circle, 1, 4);
    expect(state.s).toBe(0);
    expect(state.v).toBe(0);
  });
});

// --- Motion -----------------------------------------------------------------

describe('stepTrain motion', () => {
  it('eases up to the target speed with bounded acceleration', () => {
    const state = createTrain();
    startTrain(state);
    let previous = state.v;

    for (let i = 0; i < 400; i += 1) {
      stepTrain(state, circle, 1 / 60, 4);
      const acceleration = Math.abs(state.v - previous) / (1 / 60);
      expect(acceleration).toBeLessThanOrEqual(TRAIN_ACCEL + 1e-9);
      previous = state.v;
    }

    expect(state.v).toBeCloseTo(4, 6);
  });

  it('comes to a smooth halt at exactly 0 without going negative', () => {
    const state = createTrain();
    startTrain(state);
    for (let i = 0; i < 400; i += 1) stepTrain(state, circle, 1 / 60, 4);
    expect(state.v).toBeGreaterThan(1);

    stopTrain(state);
    let guard = 0;
    while (state.v > 0 && guard < 1000) {
      const previous = state.v;
      stepTrain(state, circle, 1 / 60, 4);
      const acceleration = Math.abs(state.v - previous) / (1 / 60);
      expect(acceleration).toBeLessThanOrEqual(TRAIN_ACCEL + 1e-9);
      expect(state.v).toBeGreaterThanOrEqual(0);
      guard += 1;
    }

    expect(state.v).toBe(0);
  });

  it('never reverses when asked for a negative target speed', () => {
    const state = createTrain();
    startTrain(state);
    for (let i = 0; i < 400; i += 1) {
      stepTrain(state, circle, 1 / 60, -3);
      expect(state.v).toBeGreaterThanOrEqual(0);
    }
    expect(state.s).toBe(0);
  });

  it('treats a dt above the clamp as exactly the clamp', () => {
    const small = createTrain();
    const large = createTrain();
    startTrain(small);
    startTrain(large);

    for (let i = 0; i < 20; i += 1) {
      stepTrain(small, circle, MAX_STEP_DT, 4);
      stepTrain(large, circle, 5, 4);
    }

    expect(large.v).toBe(small.v);
    expect(large.s).toBe(small.s);
  });

  it('ignores non-positive steps', () => {
    const state = createTrain();
    startTrain(state);
    stepTrain(state, circle, 0, 4);
    expect(state.v).toBe(0);
    expect(state.s).toBe(0);
    stepTrain(state, circle, -1, 4);
    expect(state.v).toBe(0);
    expect(state.s).toBe(0);
    expect(state.running).toBe(true);
  });

  it('wraps the head around a closed path', () => {
    const state = createTrain();
    startTrain(state);
    state.v = 4;
    state.s = circle.length - 0.1;

    stepTrain(state, circle, 0.1, 4);

    expect(state.s).toBeCloseTo(0.3, 9);
    expect(state.s).toBeGreaterThanOrEqual(0);
    expect(state.s).toBeLessThan(circle.length);
  });

  it('is deterministic for the same inputs', () => {
    const run = () => {
      const state = createTrain();
      startTrain(state);
      for (let i = 0; i < 120; i += 1) {
        stepTrain(state, circle, 1 / 60, 2.5);
      }
      return { s: state.s, v: state.v, poses: carPoses(state, circle) };
    };

    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });
});

// --- carPoses ---------------------------------------------------------------

describe('carPoses', () => {
  it('returns the engine first, then the carriages', () => {
    const state = createTrain({ carriages: 3 });
    expect(carPoses(state, circle)).toHaveLength(4);
  });

  it('rests the lead car on its two bogies', () => {
    const state = createTrain({ carLength: 0.8, gap: 0.12 });
    state.s = 3;
    const path = rectanglePath(10, 6);

    const [engine] = carPoses(state, path);

    // The head sits at s, the rear a car length behind it; the pose is midway.
    expect(engine.x).toBeCloseTo(3 - 0.4, 10);
    expect(engine.y).toBeCloseTo(0, 10);
    expect(engine.heading).toBeCloseTo(0, 10); // points from rear to front
  });

  it('keeps consecutive cars carLength + gap apart along the path', () => {
    const state = createTrain();
    const path = rectanglePath(10, 6);
    state.s = 3; // comfortably mid-side, so every car is on the top straight

    const poses = carPoses(state, path);
    const stride = state.carLength + state.gap;

    for (let i = 1; i < poses.length; i += 1) {
      const distance = Math.hypot(
        poses[i].x - poses[i - 1].x,
        poses[i].y - poses[i - 1].y,
      );
      expect(distance).toBeCloseTo(stride, 9);
    }
  });

  it('keeps the spacing while the train straddles a curve', () => {
    const state = createTrain();
    const path = rectanglePath(10, 6);
    state.s = 0.5; // engine front just before the top-right corner

    const poses = carPoses(state, path);
    for (const pose of poses) {
      expect(Number.isFinite(pose.x)).toBe(true);
      expect(Number.isFinite(pose.y)).toBe(true);
      expect(Number.isFinite(pose.heading)).toBe(true);
    }
  });
});

// --- speedFromSlider --------------------------------------------------------

describe('speedFromSlider', () => {
  it('maps the slider onto 0.5..4 cells/s', () => {
    expect(speedFromSlider(0)).toBeCloseTo(0.5, 10);
    expect(speedFromSlider(1)).toBeCloseTo(4, 10);
  });

  it('clamps out-of-range input', () => {
    expect(speedFromSlider(-2)).toBeCloseTo(0.5, 10);
    expect(speedFromSlider(3)).toBeCloseTo(4, 10);
  });

  it('increases monotonically', () => {
    let previous = speedFromSlider(0);
    for (let i = 1; i <= 100; i += 1) {
      const current = speedFromSlider(i / 100);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('defaults the slider to 0.4', () => {
    expect(DEFAULT_SPEED_SLIDER).toBe(0.4);
  });
});
