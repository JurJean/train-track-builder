/**
 * Named app intents. The DOM controls only *announce* what the player wants
 * (undo, redo, go, stop); the editor, simulation and so on subscribe here to
 * act on it. Keeping this separate means the controls never need the editor or
 * the simulation directly.
 */
export type IntentName = 'undo' | 'redo' | 'go' | 'stop';

export type IntentHandler = () => void;

const handlers = new Map<IntentName, Set<IntentHandler>>();

/** Register a handler for `name`. Returns an unsubscribe function. */
export function onIntent(name: IntentName, handler: IntentHandler): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

/** Announce `name` to every registered handler. */
export function fireIntent(name: IntentName): void {
  const set = handlers.get(name);
  if (!set) return;
  for (const handler of [...set]) handler();
}
