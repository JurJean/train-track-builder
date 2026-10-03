import { describe, expect, it } from 'vitest';
import type { Point, Pose } from '../model/types';
import {
  CAR_LENGTH,
  CARRIAGE_COLOURS,
  CHIMNEY_AT,
  carriageColour,
  chimneyPoint,
  createSteam,
  drawCarriage,
  drawEngine,
  drawSteam,
  stepSteam,
} from './train-art';

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

interface Call {
  name: string;
  args: unknown[];
}

/** A 2D context stand-in that records every method call. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {};
  const proxy = new Proxy(target, {
    get(_target, property): unknown {
      const name = String(property);
      if (name === 'createRadialGradient') {
        return (...args: unknown[]) => {
          calls.push({ name, args });
          return gradient;
        };
      }
      return (...args: unknown[]) => {
        calls.push({ name, args });
      };
    },
    set(): boolean {
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}

const HEADINGS: number[] = [];
for (let i = 0; i < 16; i += 1) HEADINGS.push((i * Math.PI) / 8, -Math.PI + (i * Math.PI) / 8);

describe('carriageColour', () => {
  it('cycles through the liveries and wraps in both directions', () => {
    expect(carriageColour(0)).toBe(CARRIAGE_COLOURS[0]);
    expect(carriageColour(2)).toBe(CARRIAGE_COLOURS[2]);
    expect(carriageColour(CARRIAGE_COLOURS.length)).toBe(CARRIAGE_COLOURS[0]);
    expect(carriageColour(-1)).toBe(CARRIAGE_COLOURS[CARRIAGE_COLOURS.length - 1]);
    expect(carriageColour(2.9)).toBe(CARRIAGE_COLOURS[2]);
  });

  it('has a few distinct, cheerful liveries', () => {
    const bodies = new Set(CARRIAGE_COLOURS.map((colour) => colour.body));
    expect(bodies.size).toBe(CARRIAGE_COLOURS.length);
    expect(CARRIAGE_COLOURS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('car dimensions', () => {
  it('is about 0.8 cells long and 0.45 wide', () => {
    expect(CAR_LENGTH).toBeCloseTo(0.8, 5);
    expect(CHIMNEY_AT).toBeGreaterThan(0);
    expect(CHIMNEY_AT).toBeLessThan(CAR_LENGTH / 2);
  });
});

describe('chimneyPoint', () => {
  it('follows the pose heading (0 = east, π/2 = south)', () => {
    expectPointClose(chimneyPoint({ x: 1, y: 2, heading: 0 }), { x: 1.2, y: 2 });
    expectPointClose(chimneyPoint({ x: 1, y: 2, heading: Math.PI / 2 }), {
      x: 1,
      y: 2.2,
    });
    expectPointClose(chimneyPoint({ x: 1, y: 2, heading: Math.PI }), { x: 0.8, y: 2 });
    expectPointClose(chimneyPoint({ x: 1, y: 2, heading: -Math.PI / 2 }), {
      x: 1,
      y: 1.8,
    });
  });
});

describe('drawing transforms', () => {
  it('rotates the engine to every heading without ever scaling', () => {
    for (const heading of HEADINGS) {
      const { ctx, calls } = recordingContext();
      drawEngine(ctx, { x: 3, y: 4, heading });

      const scaling = calls.filter((call) =>
        ['scale', 'transform', 'setTransform'].includes(call.name),
      );
      expect(scaling).toEqual([]);

      const rotations = calls.filter((call) => call.name === 'rotate');
      expect(rotations.length).toBeGreaterThan(0);
      for (const rotation of rotations) {
        expect(rotation.args[0] as number).toBeCloseTo(heading, 12);
      }
    }
  });

  it('rotates the carriage to every heading without ever scaling', () => {
    for (const heading of HEADINGS) {
      const { ctx, calls } = recordingContext();
      drawCarriage(ctx, { x: -2, y: 5, heading }, 3);

      const scaling = calls.filter((call) =>
        ['scale', 'transform', 'setTransform'].includes(call.name),
      );
      expect(scaling).toEqual([]);

      const rotations = calls.filter((call) => call.name === 'rotate');
      expect(rotations.length).toBeGreaterThan(0);
      for (const rotation of rotations) {
        expect(rotation.args[0] as number).toBeCloseTo(heading, 12);
      }
    }
  });
});

const AT_ORIGIN: Pose = { x: 0, y: 0, heading: 0 };

describe('steam', () => {
  it('emits more puffs the faster the engine goes', () => {
    const slow = createSteam();
    const fast = createSteam();
    for (let i = 0; i < 20; i += 1) {
      stepSteam(slow, 0.05, AT_ORIGIN, 0, false);
      stepSteam(fast, 0.05, AT_ORIGIN, 2, false);
    }
    expect(slow.emitted).toBeGreaterThan(0);
    expect(fast.emitted).toBeGreaterThan(slow.emitted * 2);
  });

  it('always drifts up the screen and expires', () => {
    const steam = createSteam();
    stepSteam(steam, 0.05, AT_ORIGIN, 2, false);
    stepSteam(steam, 0.05, AT_ORIGIN, 2, false);
    const first = steam.puffs[0];
    const startY = first.y;
    for (let i = 0; i < 5; i += 1) stepSteam(steam, 0.05, AT_ORIGIN, 0, false);
    expect(steam.puffs[0].y).toBeLessThan(startY);

    for (let i = 0; i < 200; i += 1) stepSteam(steam, 0.05, AT_ORIGIN, 2.4, false);
    expect(steam.puffs.length).toBeLessThan(80);
    expect(steam.puffs.every((puff) => puff.age < puff.life)).toBe(true);
  });

  it('clears everything and stops emitting under reduced motion', () => {
    const steam = createSteam();
    for (let i = 0; i < 10; i += 1) stepSteam(steam, 0.05, AT_ORIGIN, 2, false);
    expect(steam.puffs.length).toBeGreaterThan(0);
    const emitted = steam.emitted;

    stepSteam(steam, 0.05, AT_ORIGIN, 2, true);
    expect(steam.puffs.length).toBe(0);
    expect(steam.emitted).toBe(emitted);

    stepSteam(steam, 0.5, AT_ORIGIN, 2, true);
    expect(steam.puffs.length).toBe(0);
    expect(steam.emitted).toBe(emitted);
  });

  it('draws nothing for empty steam and a gradient for a puff', () => {
    const empty = recordingContext();
    drawSteam(empty.ctx, createSteam());
    expect(empty.calls).toEqual([]);

    const steam = createSteam();
    stepSteam(steam, 0.05, AT_ORIGIN, 2, false);
    stepSteam(steam, 0.05, AT_ORIGIN, 2, false);
    const drawn = recordingContext();
    drawSteam(drawn.ctx, steam);
    expect(drawn.calls.some((call) => call.name === 'createRadialGradient')).toBe(true);
    expect(drawn.calls.some((call) => call.name === 'fill')).toBe(true);
  });
});
