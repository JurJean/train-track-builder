import type { PieceKind, Rotation } from '../model/types';
import { debugHandles } from './debug';

/**
 * What the pointer will do on the board:
 * - `none`: nothing selected
 * - `place`: lay `kind` at the current `rotation`
 * - `erase`: remove whatever is under the pointer
 */
export type Tool =
  | { type: 'none' }
  | { type: 'place'; kind: PieceKind; rotation: Rotation }
  | { type: 'erase' };

export type Mode = 'build' | 'running';

export interface AppState {
  tool: Tool;
  mode: Mode;
  /** True when the track forms a closed loop the train can run on. */
  canGo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Train speed, clamped to 0..1. */
  speed: number;
  muted: boolean;
}

export type StoreListener = (state: AppState) => void;

export interface Store {
  get(): AppState;
  set(partial: Partial<AppState>): void;
  subscribe(listener: StoreListener): () => void;
}

/** localStorage key for the mute toggle. */
export const MUTED_KEY = 'ttb:muted';

export interface StoreOptions {
  /** Values layered over the defaults (handy for tests). */
  initial?: Partial<AppState>;
  /** Overridable storage; pass `null` to disable persistence. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const DEFAULTS: AppState = {
  tool: { type: 'none' },
  mode: 'build',
  canGo: false,
  canUndo: false,
  canRedo: false,
  speed: 0.4,
  muted: false,
};

function defaultStorage(): StoreOptions['storage'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Access can throw (e.g. blocked cookies); fall back to no persistence.
    return null;
  }
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.speed;
  return Math.min(1, Math.max(0, value));
}

function readMuted(storage: StoreOptions['storage']): boolean {
  try {
    return storage?.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * A tiny observable store. `set` shallow-merges a partial update into the
 * current state and notifies every subscriber with the new state. The mute
 * flag is persisted to `localStorage` so it survives a reload.
 */
export function createStore(options: StoreOptions = {}): Store {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  const initial: AppState = {
    ...DEFAULTS,
    ...options.initial,
    muted: options.initial?.muted ?? readMuted(storage),
  };
  initial.speed = clampSpeed(initial.speed);

  let state: AppState = initial;
  const listeners = new Set<StoreListener>();

  function persistMuted(muted: boolean): void {
    try {
      storage?.setItem(MUTED_KEY, muted ? 'true' : 'false');
    } catch {
      // Storage can be unavailable; muting still works for this session.
    }
  }

  return {
    get(): AppState {
      return state;
    },

    set(partial: Partial<AppState>): void {
      const next: AppState = { ...state, ...partial };
      if (partial.speed !== undefined) next.speed = clampSpeed(partial.speed);
      if (partial.muted !== undefined && partial.muted !== state.muted) {
        persistMuted(partial.muted);
      }
      state = next;
      for (const listener of [...listeners]) listener(state);
    },

    subscribe(listener: StoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Shared app store, exposed as `window.__ttb.store` in dev builds. */
export const store = createStore();

const handles = debugHandles();
if (handles) handles.store = store;
