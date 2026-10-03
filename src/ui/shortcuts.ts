import { fireIntent } from '../app/intents';
import type { Store } from '../app/store';
import { clearTool, eraseTool, rotateTool } from '../app/tools';

/** True when the player is typing into a text field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Global keyboard shortcuts:
 * - R rotate, E erase, Esc deselect
 * - Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (these fire intents)
 *
 * Shortcuts are ignored while typing in an input. Returns an uninstall function.
 */
export function installShortcuts(store: Store, target: Window = window): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;

    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      fireIntent(event.shiftKey ? 'redo' : 'undo');
      return;
    }

    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      fireIntent('redo');
      return;
    }

    if (mod || event.altKey) return;

    switch (event.key) {
      case 'r':
      case 'R':
        rotateTool(store);
        event.preventDefault();
        break;
      case 'e':
      case 'E':
        eraseTool(store);
        event.preventDefault();
        break;
      case 'Escape':
        clearTool(store);
        event.preventDefault();
        break;
      default:
        break;
    }
  }

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
