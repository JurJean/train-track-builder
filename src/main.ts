import './style.css';
import './app/debug';
import { installSfx } from './audio/sfx';
import { createBuilder } from './app/build';
import { createEditor } from './app/editor';
import { debugHandles } from './app/debug';
import { bus } from './app/events';
import { store } from './app/store';
import { GRID_COLS, GRID_ROWS } from './model/pieces';
import type { Cell, Point } from './model/types';
import { createBoard } from './render/board';
import { createPalette } from './ui/palette';
import { installShortcuts } from './ui/shortcuts';
import { createToolbar } from './ui/toolbar';

// The editor owns the current layout and exposes itself as window.__ttb.editor in dev.
const editor = createEditor();

// Sound listens to the event bus; nothing else calls the audio module directly.
installSfx();

// The palette and toolbar are pure DOM controls: they reflect window.__ttb.store
// and either update it or announce an intent.
const paletteElement = document.querySelector<HTMLElement>('#palette');
if (paletteElement) createPalette(paletteElement, store);

const toolbarElement = document.querySelector<HTMLElement>('#toolbar');
if (toolbarElement) createToolbar(toolbarElement, store);

installShortcuts(store);

const canvas = document.querySelector<HTMLCanvasElement>('#board-canvas');

if (canvas) {
  const board = createBoard(canvas, { cols: GRID_COLS, rows: GRID_ROWS });

  // Wire the board to the editor and palette so the player can build.
  const builder = createBuilder({ board, editor, store, bus, palette: paletteElement });

  // In dev, expose the live view so tests and the console can poke at it.
  const handles = debugHandles();
  if (handles) {
    handles.build = builder;
    handles.bus = bus;
    handles.view = {
      get camera() {
        return { ...board.camera };
      },
      get width() {
        return board.view().width;
      },
      get height() {
        return board.view().height;
      },
      screenToCell: (point: Point) => board.screenToCell(point),
      cellToScreen: (cell: Cell) => board.cellToScreen(cell),
      get frames() {
        return board.frames();
      },
      fit: () => board.fit(),
    };
  }
}
