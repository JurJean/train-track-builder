import { describe, expect, it } from 'vitest';
import type { PlacedPiece, Pose } from '../model/types';
import { TUNNEL_FADE, carOpacity, tunnelPenetration } from './tunnel';

function tunnel(rotation: PlacedPiece['rotation'], x = 0, y = 0): PlacedPiece {
  return { id: 't', kind: 'tunnel', origin: { x, y }, rotation };
}

function at(x: number, y: number): Pose {
  return { x, y, heading: 0 };
}

const vertical = tunnel(0); // portals north and south
const horizontal = tunnel(1); // portals west and east

describe('tunnelPenetration', () => {
  it('is null outside the tunnel cell', () => {
    expect(tunnelPenetration(at(-0.1, 0.5), vertical)).toBeNull();
    expect(tunnelPenetration(at(1.0, 0.5), vertical)).toBeNull();
    expect(tunnelPenetration(at(0.5, 1.2), vertical)).toBeNull();
  });

  it('grows from 0 at a portal to 0.5 in the middle', () => {
    expect(tunnelPenetration(at(0.5, 0), vertical)).toBeCloseTo(0, 10);
    expect(tunnelPenetration(at(0.5, 0.5), vertical)).toBeCloseTo(0.5, 10);
    expect(tunnelPenetration(at(0.5, 1), vertical)).toBeCloseTo(0, 10);
  });

  it('measures along the track for each rotation', () => {
    // Vertical tunnel ignores x; horizontal tunnel ignores y.
    expect(tunnelPenetration(at(0.2, 0.3), vertical)).toBeCloseTo(0.3, 10);
    expect(tunnelPenetration(at(0.3, 0.2), horizontal)).toBeCloseTo(0.3, 10);
    expect(tunnelPenetration(at(0.2, 0.9), horizontal)).toBeCloseTo(0.2, 10);
  });

  it('follows the tunnel to its origin', () => {
    const shifted = tunnel(0, 5, 7);
    expect(tunnelPenetration(at(5.5, 7.5), shifted)).toBeCloseTo(0.5, 10);
  });
});

describe('carOpacity', () => {
  it('is fully visible with no tunnels or outside every tunnel', () => {
    expect(carOpacity(at(0.5, 0.5), [])).toBe(1);
    expect(carOpacity(at(3, 3), [vertical, horizontal])).toBe(1);
  });

  it('is fully opaque at a portal and hidden between the portals', () => {
    expect(carOpacity(at(0.5, 0), [vertical])).toBeCloseTo(1, 10);
    expect(carOpacity(at(0.5, 0.5), [vertical])).toBe(0);
  });

  it('fades linearly over TUNNEL_FADE cells from a portal', () => {
    expect(carOpacity(at(0.5, TUNNEL_FADE / 2), [vertical])).toBeCloseTo(0.5, 10);
    expect(carOpacity(at(0.5, TUNNEL_FADE), [vertical])).toBe(0);
  });

  it('uses the most hidden tunnel when they overlap', () => {
    const second = tunnel(1, 0, 0);
    expect(carOpacity(at(0.5, 0.5), [vertical, second])).toBe(0);
  });
});
