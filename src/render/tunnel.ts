import type { PlacedPiece, Pose } from '../model/types';

/**
 * Tunnel hiding for the train layer.
 *
 * A tunnel is a one-cell straight piece: its two portals are the two ends the
 * track enters and leaves. A car whose centre is inside the tunnel's cell is
 * between those portals, so it is hidden; near a portal it fades so it does not
 * pop in and out. Everything here is pure world maths in cells, so it can be
 * unit tested without a canvas.
 */

/** Fraction of a cell over which a car fades behind a tunnel portal. */
export const TUNNEL_FADE = 0.4;

/**
 * How far a car's centre is into `tunnel`, 0 at a portal and 0.5 at the middle,
 * or null when the centre is outside the tunnel's cell.
 */
export function tunnelPenetration(pose: Pose, tunnel: PlacedPiece): number | null {
  const lx = pose.x - tunnel.origin.x;
  const ly = pose.y - tunnel.origin.y;
  if (lx < 0 || lx >= 1 || ly < 0 || ly >= 1) return null;

  // Rotation 0/2 run the track north-south, rotation 1/3 east-west.
  const along = tunnel.rotation % 2 === 0 ? ly : lx;
  return Math.min(along, 1 - along);
}

/**
 * Opacity for a car at `pose`: fully visible outside every tunnel, fading to
 * nothing as its centre travels between a tunnel's two portals.
 */
export function carOpacity(pose: Pose, tunnels: readonly PlacedPiece[]): number {
  let opacity = 1;
  for (const tunnel of tunnels) {
    const penetration = tunnelPenetration(pose, tunnel);
    if (penetration === null) continue;
    const fade = 1 - penetration / TUNNEL_FADE;
    if (fade < opacity) opacity = fade < 0 ? 0 : fade;
  }
  return opacity;
}
