export interface DebugHandles {
  store?: unknown;
  editor?: unknown;
  view?: unknown;
  train?: unknown;
  sfx?: unknown;
}

declare global {
  interface Window {
    __ttb?: DebugHandles;
  }
}

if (import.meta.env.DEV) {
  window.__ttb = window.__ttb ?? {};
}

export function debugHandles(): DebugHandles | undefined {
  return window.__ttb;
}
