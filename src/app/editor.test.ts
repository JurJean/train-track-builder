import { describe, expect, it } from 'vitest';
import { createEditor } from './editor';
import { createEventBus } from './events';
import type { EventBus } from './events';
import type { Cell, Layout, PlacedPiece } from '../model/types';

const at = (x: number, y: number): Cell => ({ x, y });

/** Counts every layout-changed event on the bus. */
function countChanges(bus: EventBus): () => number {
  let count = 0;
  bus.on('layout-changed', () => {
    count += 1;
  });
  return () => count;
}

describe('createEditor', () => {
  it('starts on the empty grid with no history', () => {
    const editor = createEditor(createEventBus());
    expect(editor.layout().pieces).toEqual([]);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.undo()).toBeUndefined();
    expect(editor.redo()).toBeUndefined();
  });

  it('emits piece-placed and exactly one layout-changed per placement', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const placed: Array<{ piece: PlacedPiece; joined: number }> = [];
    bus.on('piece-placed', (payload) => placed.push(payload));
    const changes = countChanges(bus);

    const piece = editor.place('straight', at(5, 5), 0);

    expect(piece).not.toBeNull();
    expect(placed).toHaveLength(1);
    expect(placed[0]).toEqual({ piece, joined: 0 });
    expect(changes()).toBe(1);
    expect(editor.layout().pieces).toHaveLength(1);
  });

  it('reports the join count when a piece connects', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const joined: number[] = [];
    bus.on('piece-placed', (payload) => joined.push(payload.joined));

    editor.place('straight', at(5, 5), 0);
    editor.place('straight', at(5, 4), 0);
    editor.place('straight', at(5, 3), 0);
    expect(joined).toEqual([0, 1, 1]);
  });

  it('rejects invalid placements without emitting layout-changed', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const reasons: string[] = [];
    bus.on('placement-rejected', (payload) => reasons.push(payload.reason));
    const changes = countChanges(bus);

    editor.place('straight', at(5, 5), 0); // valid
    const overlap = editor.place('straight', at(5, 5), 0); // overlaps
    const offGrid = editor.place('straight', at(-1, 0), 0); // out of bounds

    expect(overlap).toBeNull();
    expect(offGrid).toBeNull();
    expect(reasons).toEqual(['overlap', 'out-of-bounds']);
    expect(changes()).toBe(1);
    expect(editor.layout().pieces).toHaveLength(1);
  });

  it('removes a multi-cell piece by any of its cells', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const removed: PlacedPiece[] = [];
    bus.on('piece-removed', (payload) => removed.push(payload.piece));
    const changes = countChanges(bus);

    const station = editor.place('station', at(5, 5), 0);
    const result = editor.removeAt(at(5, 6)); // the other half

    expect(result?.id).toBe(station?.id);
    expect(removed).toHaveLength(1);
    expect(changes()).toBe(2);
    expect(editor.layout().pieces).toEqual([]);
  });

  it('does nothing when removing from an empty cell', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const changes = countChanges(bus);

    editor.place('straight', at(5, 5), 0);
    expect(editor.removeAt(at(0, 0))).toBeNull();
    expect(changes()).toBe(1);
  });

  it('undoes and redoes with one layout-changed each, and no event when empty', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const changes = countChanges(bus);

    editor.place('straight', at(5, 5), 0);
    expect(changes()).toBe(1);

    editor.undo();
    expect(changes()).toBe(2);
    expect(editor.layout().pieces).toEqual([]);
    expect(editor.canRedo()).toBe(true);

    editor.undo(); // nothing left to undo
    expect(changes()).toBe(2);

    editor.redo();
    expect(changes()).toBe(3);
    expect(editor.layout().pieces).toHaveLength(1);

    editor.redo(); // nothing left to redo
    expect(changes()).toBe(3);
  });

  it('loads a layout, clears history, and emits layout-changed', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const changes = countChanges(bus);

    editor.place('straight', at(5, 5), 0);
    expect(changes()).toBe(1);

    const custom: Layout = {
      cols: 8,
      rows: 8,
      pieces: [{ id: 'p9', kind: 'station', origin: { x: 1, y: 1 }, rotation: 0 }],
    };
    editor.load(custom);

    expect(editor.layout()).toEqual(custom);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(changes()).toBe(2);

    editor.undo(); // history was cleared by load
    expect(editor.layout()).toEqual(custom);
    expect(changes()).toBe(2);
  });

  it('keeps ids unique through a remove followed by a place', () => {
    const editor = createEditor(createEventBus());
    editor.place('straight', at(1, 1), 0);
    editor.place('straight', at(3, 1), 0);
    editor.place('straight', at(5, 1), 0);

    expect(editor.removeAt(at(3, 1))?.id).toBe('p2');
    expect(editor.place('straight', at(3, 1), 0)?.id).toBe('p4');

    const ids = editor.layout().pieces.map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('survives 1,000 placements, a full undo and a full redo', () => {
    const bus = createEventBus();
    const editor = createEditor(bus);
    const empty: Layout = { cols: 64, rows: 32, pieces: [] };
    editor.load(empty);

    let layout: Layout = empty;
    for (let i = 0; i < 1000; i += 1) {
      const piece = editor.place('straight', at(i % 64, Math.floor(i / 64)), 0);
      if (!piece) throw new Error(`placement ${i} failed`);
      layout = editor.layout();
    }
    expect(layout.pieces).toHaveLength(1000);

    for (let i = 0; i < 1000; i += 1) editor.undo();
    expect(editor.layout()).toEqual(empty);
    expect(editor.canUndo()).toBe(false);

    for (let i = 0; i < 1000; i += 1) editor.redo();
    expect(editor.layout()).toEqual(layout);
    expect(editor.canRedo()).toBe(false);
  });
});
