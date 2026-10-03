import type { Layout, PlacedPiece } from '../model/types';

export interface AppEvents {
  'layout-changed': { layout: Layout };
  'piece-placed': { piece: PlacedPiece; joined: number };
  'piece-removed': { piece: PlacedPiece };
  'placement-rejected': { reason: string };
  'train-started': {};
  'train-stopped': {};
  'mute-changed': { muted: boolean };
}

export type EventType = keyof AppEvents;
export type EventHandler<T extends EventType> = (payload: AppEvents[T]) => void;

export interface EventBus {
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void;
  emit<T extends EventType>(type: T, payload: AppEvents[T]): void;
}

type AnyHandler = (payload: never) => void;

export function createEventBus(): EventBus {
  const handlers = new Map<EventType, Set<AnyHandler>>();

  return {
    on<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
      let listeners = handlers.get(type);
      if (!listeners) {
        listeners = new Set();
        handlers.set(type, listeners);
      }
      const anyHandler = handler as unknown as AnyHandler;
      listeners.add(anyHandler);
      return () => {
        listeners.delete(anyHandler);
      };
    },
    emit<T extends EventType>(type: T, payload: AppEvents[T]): void {
      const listeners = handlers.get(type);
      if (!listeners) return;
      for (const handler of [...listeners]) {
        handler(payload as never);
      }
    },
  };
}

export const bus = createEventBus();
