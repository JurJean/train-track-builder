import './style.css';
import './app/debug';
import { createEditor } from './app/editor';
import { debugHandles } from './app/debug';
import { GRID_COLS, GRID_ROWS } from './model/pieces';
import type { Cell, Point } from './model/types';
import { createBoard } from './render/board';

// The editor owns the current layout and exposes itself as window.__ttb.editor in dev.
createEditor();

const canvas = document.querySelector<HTMLCanvasElement>('#board-canvas');

if (canvas) {
  const board = createBoard(canvas, { cols: GRID_COLS, rows: GRID_ROWS });

  // In dev, expose the live view so tests and the console can poke at it.
  const handles = debugHandles();
  if (handles) {
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
