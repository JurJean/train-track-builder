import { checkPlacement, pieceAt } from '../model/layout';
import { occupiedCells } from '../model/pieces';
import type { Cell, PieceKind, PlacedPiece, Rotation } from '../model/types';
import type { Board, PointerInfo } from '../render/board';
import { drawPiece } from '../render/track-art';
import type { Editor } from './editor';
import type { EventBus } from './events';
import { bus as defaultBus } from './events';
import { onIntent } from './intents';
import type { Store } from './store';
import { selectPiece } from './tools';

/**
 * Connects the palette, the board, the piece art and the editor so a player can
 * actually build: a track layer paints `editor.layout()`, a ghost follows the
 * pointer, clicks and taps place or erase, palette drags work with touch, and
 * the undo/redo intents drive the editor while the store's `canUndo`/`canRedo`
 * flags stay in sync.
 */
export interface Builder {
  /** Cell currently getting build feedback (hover, touch or palette drag). */
  pointerCell(): Cell | null;
  destroy(): void;
}

export interface BuilderOptions {
  board: Board;
  editor: Editor;
  store: Store;
  /** Event bus carrying `layout-changed`; defaults to the shared bus. */
  bus?: EventBus;
  /** Where the piece buttons live; defaults to `#palette`. */
  palette?: HTMLElement | null;
}

/** Layers: track under the transient ghost/highlight. */
const TRACK_Z = 10;
const FEEDBACK_Z = 20;

const ERASE_FILL = 'rgba(192, 57, 43, 0.30)';
const ERASE_STROKE = 'rgba(122, 45, 34, 0.85)';

interface PaletteDrag {
  pointerId: number;
  kind: PieceKind;
  rotation: Rotation;
  cell: Cell | null;
}

function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

function drawEraseHighlight(ctx: CanvasRenderingContext2D, piece: PlacedPiece): void {
  ctx.save();
  ctx.fillStyle = ERASE_FILL;
  ctx.strokeStyle = ERASE_STROKE;
  ctx.lineWidth = 0.06;
  for (const cell of occupiedCells(piece)) {
    ctx.fillRect(cell.x + 0.03, cell.y + 0.03, 0.94, 0.94);
    ctx.strokeRect(cell.x + 0.03, cell.y + 0.03, 0.94, 0.94);
  }
  ctx.restore();
}

export function createBuilder(options: BuilderOptions): Builder {
  const { board, editor, store } = options;
  const bus = options.bus ?? defaultBus;
  const palette = options.palette ?? document.querySelector<HTMLElement>('#palette');

  let pointerCell: Cell | null = null;
  let paletteDrag: PaletteDrag | null = null;
  const activeTouches = new Set<number>();
  let touchGesture = false;

  // --- drawing -----------------------------------------------------------

  function drawTrack(ctx: CanvasRenderingContext2D): void {
    for (const piece of editor.layout().pieces) drawPiece(ctx, piece);
  }

  function drawFeedback(ctx: CanvasRenderingContext2D): void {
    if (!pointerCell) return;
    const tool = store.get().tool;

    if (tool.type === 'place') {
      const check = checkPlacement(editor.layout(), tool.kind, pointerCell, tool.rotation);
      const ghost: PlacedPiece = {
        id: 'ghost',
        kind: tool.kind,
        origin: pointerCell,
        rotation: tool.rotation,
      };
      drawPiece(ctx, ghost, { ghost: check.ok ? 'valid' : 'invalid' });
    } else if (tool.type === 'erase') {
      const piece = pieceAt(editor.layout(), pointerCell);
      if (piece) drawEraseHighlight(ctx, piece);
    }
  }

  // --- state -------------------------------------------------------------

  function setPointerCell(next: Cell | null): void {
    // Only track the pointer when a building tool can show something.
    const wanted = store.get().tool.type === 'none' ? null : next;
    if (sameCell(pointerCell, wanted)) return;
    pointerCell = wanted;
    board.markDirty();
  }

  function actAt(cell: Cell): void {
    const tool = store.get().tool;
    if (tool.type === 'place') editor.place(tool.kind, cell, tool.rotation);
    else if (tool.type === 'erase') editor.removeAt(cell);
  }

  function cellFromClient(clientX: number, clientY: number): Cell | null {
    const rect = board.canvas.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientY < rect.top ||
      clientX >= rect.right ||
      clientY >= rect.bottom
    ) {
      return null;
    }
    return board.screenToCell({ x: clientX - rect.left, y: clientY - rect.top });
  }

  // --- board pointer interaction ----------------------------------------

  function onPointerDown(info: PointerInfo): void {
    if (paletteDrag) return;

    if (info.pointerType === 'touch') {
      activeTouches.add(info.pointerId);
      if (activeTouches.size >= 2) {
        // Two fingers mean a camera gesture; the build must not interfere.
        touchGesture = true;
        setPointerCell(null);
      } else if (!touchGesture) {
        setPointerCell(info.cell);
      }
      return;
    }

    if (info.button === 0) setPointerCell(info.cell);
  }

  function onPointerMove(info: PointerInfo): void {
    if (paletteDrag) return;

    if (info.pointerType === 'touch') {
      if (!touchGesture && activeTouches.has(info.pointerId)) setPointerCell(info.cell);
      return;
    }

    setPointerCell(info.cell);
  }

  function onPointerUp(info: PointerInfo): void {
    if (paletteDrag) return;

    if (info.pointerType === 'touch') {
      const wasActive = activeTouches.delete(info.pointerId);
      if (wasActive && !touchGesture) actAt(info.cell);
      if (activeTouches.size === 0) {
        touchGesture = false;
        setPointerCell(null);
      }
      return;
    }

    if (info.button === 0 && !info.panning) actAt(info.cell);
  }

  function onPointerLeave(): void {
    if (paletteDrag || activeTouches.size > 0) return;
    setPointerCell(null);
  }

  // --- palette drag (pointer events, so touch works) ---------------------

  function pieceButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>('.piece');
    return button?.dataset.kind ? button : null;
  }

  function onPalettePointerDown(event: PointerEvent): void {
    if (paletteDrag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const button = pieceButton(event.target);
    if (!button) return;

    const kind = button.dataset.kind as PieceKind;
    selectPiece(store, kind);
    const tool = store.get().tool;
    const rotation: Rotation = tool.type === 'place' ? tool.rotation : 0;
    paletteDrag = { pointerId: event.pointerId, kind, rotation, cell: null };

    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers dispatched in tests cannot be captured; window
      // listeners still see the moves.
    }
  }

  function onWindowPointerMove(event: PointerEvent): void {
    if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
    paletteDrag.cell = cellFromClient(event.clientX, event.clientY);
    setPointerCell(paletteDrag.cell);
  }

  function onWindowPointerUp(event: PointerEvent): void {
    if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
    const drag = paletteDrag;
    paletteDrag = null;
    const cell = drag.cell ?? cellFromClient(event.clientX, event.clientY);
    if (cell) editor.place(drag.kind, cell, drag.rotation);
    setPointerCell(null);
  }

  function onWindowPointerCancel(event: PointerEvent): void {
    if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
    paletteDrag = null;
    setPointerCell(null);
  }

  // --- keep the store's history flags in sync ---------------------------

  function syncHistory(): void {
    store.set({ canUndo: editor.canUndo(), canRedo: editor.canRedo() });
  }

  // --- wiring ------------------------------------------------------------

  const removeTrackLayer = board.addLayer(TRACK_Z, drawTrack);
  const removeFeedbackLayer = board.addLayer(FEEDBACK_Z, drawFeedback);

  const offStore = store.subscribe(() => {
    // Deselecting the tool should drop any lingering ghost/highlight.
    if (store.get().tool.type === 'none') setPointerCell(null);
    board.markDirty();
  });
  const offLayout = bus.on('layout-changed', () => {
    syncHistory();
    board.markDirty();
  });
  const offUndo = onIntent('undo', () => editor.undo());
  const offRedo = onIntent('redo', () => editor.redo());

  const offDown = board.onPointerDown(onPointerDown);
  const offMove = board.onPointerMove(onPointerMove);
  const offUp = board.onPointerUp(onPointerUp);
  const offLeave = board.onPointerLeave(onPointerLeave);

  palette?.addEventListener('pointerdown', onPalettePointerDown as EventListener);
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);

  syncHistory();

  const builder: Builder = {
    pointerCell: () => pointerCell,
    destroy(): void {
      removeTrackLayer();
      removeFeedbackLayer();
      offStore();
      offLayout();
      offUndo();
      offRedo();
      offDown();
      offMove();
      offUp();
      offLeave();
      palette?.removeEventListener('pointerdown', onPalettePointerDown as EventListener);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    },
  };

  return builder;
}
