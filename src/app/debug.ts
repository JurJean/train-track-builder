export interface DebugHandles {
  store?: unknown;
  editor?: unknown;
  view?: unknown;
  train?: unknown;
  sfx?: unknown;
  preview?: unknown;
}

declare global {
  interface Window {
    __ttb?: DebugHandles;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__ttb = window.__ttb ?? {};
}

export function debugHandles(): DebugHandles | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__ttb;
}
