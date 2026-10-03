import { History } from '../model/history';
import { checkPlacement, emptyLayout, placePiece, removePieceAt } from '../model/layout';
import type { Cell, Layout, PieceKind, PlacedPiece, Rotation } from '../model/types';
import { debugHandles } from './debug';
import { bus as defaultBus } from './events';
import type { EventBus } from './events';

export interface Editor {
  /** The layout currently in effect. */
  layout(): Layout;
  /** Tries to place a piece. Returns it, or null if the placement is invalid. */
  place(kind: PieceKind, origin: Cell, rotation: Rotation): PlacedPiece | null;
  /** Removes the piece covering `cell`, if any. Returns it, or null. */
  removeAt(cell: Cell): PlacedPiece | null;
  undo(): void;
  redo(): void;
  /** Replaces the layout and clears the undo history. */
  load(layout: Layout): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createEditor(eventBus: EventBus = defaultBus): Editor {
  const history = new History<Layout>(emptyLayout());

  const editor: Editor = {
    layout(): Layout {
      return history.present;
    },

    place(kind, origin, rotation): PlacedPiece | null {
      const result = placePiece(history.present, kind, origin, rotation);
      if (!result) {
        const check = checkPlacement(history.present, kind, origin, rotation);
        eventBus.emit('placement-rejected', {
          reason: check.ok ? 'overlap' : check.reason,
        });
        return null;
      }

      history.push(result.layout);
      eventBus.emit('piece-placed', { piece: result.piece, joined: result.joins });
      eventBus.emit('layout-changed', { layout: history.present });
      return result.piece;
    },

    removeAt(cell): PlacedPiece | null {
      const { layout, removed } = removePieceAt(history.present, cell);
      if (!removed) return null;

      history.push(layout);
      eventBus.emit('piece-removed', { piece: removed });
      eventBus.emit('layout-changed', { layout: history.present });
      return removed;
    },

    undo(): void {
      if (!history.canUndo) return;
      history.undo();
      eventBus.emit('layout-changed', { layout: history.present });
    },

    redo(): void {
      if (!history.canRedo) return;
      history.redo();
      eventBus.emit('layout-changed', { layout: history.present });
    },

    load(layout): void {
      history.reset(layout);
      eventBus.emit('layout-changed', { layout: history.present });
    },

    canUndo(): boolean {
      return history.canUndo;
    },

    canRedo(): boolean {
      return history.canRedo;
    },
  };

  const handles = debugHandles();
  if (handles) handles.editor = editor;

  return editor;
}
