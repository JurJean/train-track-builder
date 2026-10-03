import { describe, expect, it } from 'vitest';
import { MUTED_KEY, createStore } from './store';
import type { AppState, Store } from './store';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    raw(): Record<string, string> {
      return Object.fromEntries(data);
    },
  };
}

function collect(store: Store): AppState[] {
  const seen: AppState[] = [];
  store.subscribe((state) => seen.push(state));
  return seen;
}

describe('createStore', () => {
  it('starts with the documented defaults', () => {
    const store = createStore({ storage: null });
    expect(store.get()).toEqual({
      tool: { type: 'none' },
      mode: 'build',
      canGo: false,
      canUndo: false,
      canRedo: false,
      speed: 0.4,
      muted: false,
    });
  });

  it('shallow-merges partial updates and keeps the rest', () => {
    const store = createStore({ storage: null });
    store.set({ canGo: true, mode: 'running' });

    expect(store.get().canGo).toBe(true);
    expect(store.get().mode).toBe('running');
    expect(store.get().tool).toEqual({ type: 'none' });
    expect(store.get().speed).toBe(0.4);
  });

  it('replaces the tool object wholesale', () => {
    const store = createStore({ storage: null });
    store.set({ tool: { type: 'place', kind: 'straight', rotation: 0 } });
    store.set({ tool: { type: 'erase' } });
    expect(store.get().tool).toEqual({ type: 'erase' });
  });

  it('notifies subscribers with the new state and stops after unsubscribe', () => {
    const store = createStore({ storage: null });
    const seen = collect(store);

    store.set({ canGo: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.canGo).toBe(true);

    const unsubscribe = store.subscribe(() => undefined);
    unsubscribe();
    store.set({ canGo: false });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.canGo).toBe(false);
  });

  it('clamps speed to 0..1 and ignores non-finite values', () => {
    const store = createStore({ storage: null });
    store.set({ speed: 2 });
    expect(store.get().speed).toBe(1);
    store.set({ speed: -3 });
    expect(store.get().speed).toBe(0);
    store.set({ speed: Number.NaN });
    expect(store.get().speed).toBe(0.4);
    store.set({ speed: 0.65 });
    expect(store.get().speed).toBe(0.65);
  });

  it('reads the muted flag from storage', () => {
    const store = createStore({ storage: fakeStorage({ [MUTED_KEY]: 'true' }) });
    expect(store.get().muted).toBe(true);
  });

  it('persists muted changes to storage', () => {
    const storage = fakeStorage();
    const store = createStore({ storage });

    store.set({ muted: true });
    expect(storage.raw()).toEqual({ [MUTED_KEY]: 'true' });

    store.set({ muted: false });
    expect(storage.raw()).toEqual({ [MUTED_KEY]: 'false' });
  });

  it('lets explicit initial values win over storage', () => {
    const store = createStore({
      initial: { muted: false },
      storage: fakeStorage({ [MUTED_KEY]: 'true' }),
    });
    expect(store.get().muted).toBe(false);
  });

  it('works without storage', () => {
    const store = createStore({ storage: null });
    store.set({ muted: true });
    expect(store.get().muted).toBe(true);
  });
});
