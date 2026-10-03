import './style.css';
import './app/debug';
import { createEditor } from './app/editor';

// The editor owns the current layout and exposes itself as window.__ttb.editor in dev.
createEditor();

const canvas = document.querySelector<HTMLCanvasElement>('#board-canvas');

function resize(): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

resize();
window.addEventListener('resize', resize);
if (canvas && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resize).observe(canvas);
}
