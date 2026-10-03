import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('starts on the initial value with nothing to undo or redo', () => {
    const history = new History('a');
    expect(history.present).toBe('a');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('treats undo and redo on an empty stack as no-ops', () => {
    const history = new History('a');
    history.undo();
    expect(history.present).toBe('a');
    history.redo();
    expect(history.present).toBe('a');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('pushes, undoes and redoes', () => {
    const history = new History('a');
    history.push('b');
    history.push('c');
    expect(history.present).toBe('c');
    expect(history.canUndo).toBe(true);

    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    expect(history.redo()).toBe('b');
    expect(history.redo()).toBe('c');
    expect(history.canRedo).toBe(false);
    expect(history.present).toBe('c');
  });

  it('drops the redo branch when pushing after an undo', () => {
    const history = new History('a');
    history.push('b');
    history.push('c');
    history.undo(); // back to b, c is redoable
    history.push('d');
    expect(history.present).toBe('d');
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe('b');
  });

  it('reset clears both directions', () => {
    const history = new History('a');
    history.push('b');
    history.undo();
    history.reset('z');
    expect(history.present).toBe('z');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('survives 1,000 pushes, then a full undo and a full redo', () => {
    const history = new History(0);
    for (let i = 1; i <= 1000; i += 1) history.push(i);
    expect(history.present).toBe(1000);

    for (let i = 0; i < 1000; i += 1) history.undo();
    expect(history.present).toBe(0);
    expect(history.canUndo).toBe(false);

    for (let i = 0; i < 1000; i += 1) history.redo();
    expect(history.present).toBe(1000);
    expect(history.canRedo).toBe(false);
  });
});
