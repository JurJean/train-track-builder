import type { PieceKind, Rotation } from '../model/types';
import type { Store } from './store';

/** Rotation to use for the next placement: the current one, or 0. */
export function currentRotation(store: Store): Rotation {
  const { tool } = store.get();
  return tool.type === 'place' ? tool.rotation : 0;
}

/** Arm the palette with `kind`, keeping the current rotation. */
export function selectPiece(store: Store, kind: PieceKind): void {
  store.set({ tool: { type: 'place', kind, rotation: currentRotation(store) } });
}

/** Turn the selected piece a quarter turn clockwise. */
export function rotateTool(store: Store): void {
  const { tool } = store.get();
  if (tool.type !== 'place') return;
  store.set({ tool: { ...tool, rotation: ((tool.rotation + 1) % 4) as Rotation } });
}

/** Switch to the erase tool. */
export function eraseTool(store: Store): void {
  store.set({ tool: { type: 'erase' } });
}

/** Deselect everything. */
export function clearTool(store: Store): void {
  store.set({ tool: { type: 'none' } });
}
