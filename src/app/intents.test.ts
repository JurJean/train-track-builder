import { describe, expect, it } from 'vitest';
import { fireIntent, onIntent } from './intents';

describe('intents', () => {
  it('calls every handler registered for an intent', () => {
    const calls: string[] = [];
    const offA = onIntent('undo', () => calls.push('a'));
    const offB = onIntent('undo', () => calls.push('b'));

    fireIntent('undo');
    expect(calls).toEqual(['a', 'b']);

    offA();
    offB();
    expect(calls).toEqual(['a', 'b']);
  });

  it('keeps intents separate', () => {
    const calls: string[] = [];
    const off = onIntent('go', () => calls.push('go'));

    fireIntent('stop');
    expect(calls).toEqual([]);

    fireIntent('go');
    expect(calls).toEqual(['go']);
    off();
  });
});
