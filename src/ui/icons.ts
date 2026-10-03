import type { PieceKind } from '../model/types';

/** Palette order, exactly as specified in the issue. */
export const PIECE_ORDER: PieceKind[] = [
  'straight',
  'curve-gentle',
  'curve-sharp',
  'crossing',
  'bridge',
  'tunnel',
  'station',
  'buffer-stop',
];

export const PIECE_NAMES: Record<PieceKind, string> = {
  straight: 'Straight',
  'curve-gentle': 'Gentle curve',
  'curve-sharp': 'Sharp curve',
  crossing: 'Crossing',
  bridge: 'Bridge',
  tunnel: 'Tunnel',
  station: 'Station',
  'buffer-stop': 'Buffer stop',
};

const PATHS: Record<PieceKind, string> = {
  straight: '<line x1="12" y1="2" x2="12" y2="22" />',
  'curve-gentle': '<path d="M4 20 A16 16 0 0 1 20 4" />',
  'curve-sharp': '<path d="M5 20 L5 9 Q5 5 9 5 L20 5" />',
  crossing:
    '<line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />',
  bridge:
    '<line x1="2" y1="9" x2="22" y2="9" /><line x1="2" y1="15" x2="22" y2="15" />' +
    '<line x1="7" y1="9" x2="7" y2="15" /><line x1="17" y1="9" x2="17" y2="15" />',
  tunnel:
    '<path d="M4 20 V12 A8 8 0 0 1 20 12 V20" /><line x1="2" y1="20" x2="22" y2="20" />',
  station:
    '<path d="M4 20 V11 L12 5 L20 11 V20" /><rect x="9" y="14" width="6" height="6" />',
  'buffer-stop':
    '<line x1="12" y1="3" x2="12" y2="16" /><line x1="5" y1="16" x2="19" y2="16" />' +
    '<line x1="8" y1="19" x2="16" y2="19" />',
};

function wrap(body: string): string {
  return (
    '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" ' +
    'focusable="false" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

/** Inline SVG icon for a track piece. */
export function svgIcon(kind: PieceKind): string {
  return wrap(PATHS[kind]);
}

export function rotateIcon(): string {
  return wrap('<path d="M20 12 A8 8 0 1 1 15 5" /><polyline points="15 1 20 5 15 9" />');
}

export function eraseIcon(): string {
  return wrap(
    '<path d="M7 18 L16 9 L21 14 L16 19 Z" />' +
      '<line x1="3" y1="21" x2="13" y2="21" />',
  );
}
