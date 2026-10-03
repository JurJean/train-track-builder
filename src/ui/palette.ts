import type { PieceKind } from '../model/types';
import type { Store } from '../app/store';
import { eraseTool, rotateTool, selectPiece } from '../app/tools';
import { PIECE_NAMES, PIECE_ORDER, eraseIcon, rotateIcon, svgIcon } from './icons';

export interface Palette {
  destroy(): void;
}

const ROTATION_LABELS = ['0°', '90°', '180°', '270°'] as const;

/**
 * Builds the `#palette`: eight piece buttons, Rotate and Erase. Every control
 * only updates the store; nothing here touches the board.
 */
export function createPalette(container: HTMLElement, store: Store): Palette {
  container.textContent = '';

  const title = document.createElement('h2');
  title.className = 'palette-title';
  title.textContent = 'Pieces';

  const scroll = document.createElement('div');
  scroll.className = 'palette-scroll';

  const hint = document.createElement('p');
  hint.className = 'palette-hint';
  hint.textContent = 'Pick a piece to lay track.';

  const grid = document.createElement('div');
  grid.className = 'palette-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Track pieces');

  const pieceButtons = new Map<PieceKind, HTMLButtonElement>();

  for (const kind of PIECE_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'piece';
    button.dataset.kind = kind;
    button.setAttribute('aria-pressed', 'false');

    const icon = document.createElement('span');
    icon.className = 'piece-icon';
    icon.innerHTML = svgIcon(kind);

    const name = document.createElement('span');
    name.className = 'piece-name';
    name.textContent = PIECE_NAMES[kind];

    // A selected marker that is not part of the accessible name.
    const check = document.createElement('span');
    check.className = 'piece-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';

    button.append(icon, name, check);
    button.addEventListener('click', () => selectPiece(store, kind));
    button.addEventListener('pointerenter', () => showPreview(kind));
    button.addEventListener('pointerleave', () => showPreview(null));
    button.addEventListener('focus', () => showPreview(kind));
    button.addEventListener('blur', () => showPreview(null));

    pieceButtons.set(kind, button);
    grid.append(button);
  }

  const actions = document.createElement('div');
  actions.className = 'palette-actions';

  const rotateButton = document.createElement('button');
  rotateButton.type = 'button';
  rotateButton.id = 'rotate-btn';
  rotateButton.className = 'palette-action';
  rotateButton.innerHTML = `<span class="action-icon">${rotateIcon()}</span><span>Rotate</span>`;
  rotateButton.title = 'Rotate the selected piece (R)';
  rotateButton.addEventListener('click', () => rotateTool(store));

  const eraseButton = document.createElement('button');
  eraseButton.type = 'button';
  eraseButton.id = 'erase-btn';
  eraseButton.className = 'palette-action';
  eraseButton.setAttribute('aria-pressed', 'false');
  eraseButton.innerHTML = `<span class="action-icon">${eraseIcon()}</span><span>Erase</span>`;
  eraseButton.title = 'Erase pieces (E)';
  eraseButton.addEventListener('click', () => eraseTool(store));

  actions.append(rotateButton, eraseButton);

  const preview = document.createElement('div');
  preview.className = 'piece-preview';
  preview.id = 'piece-preview';
  preview.setAttribute('aria-hidden', 'true');

  const previewIcon = document.createElement('span');
  previewIcon.className = 'preview-icon';
  const previewText = document.createElement('span');
  previewText.className = 'preview-text';
  preview.append(previewIcon, previewText);

  scroll.append(hint, grid, actions);
  container.append(title, scroll, preview);

  let hovered: PieceKind | null = null;

  function showPreview(kind: PieceKind | null): void {
    hovered = kind;
    renderPreview();
  }

  function renderPreview(): void {
    const { tool } = store.get();

    if (hovered) {
      previewIcon.innerHTML = svgIcon(hovered);
      previewText.textContent = PIECE_NAMES[hovered];
      return;
    }

    if (tool.type === 'place') {
      previewIcon.innerHTML = svgIcon(tool.kind);
      previewText.textContent = `${PIECE_NAMES[tool.kind]} · ${ROTATION_LABELS[tool.rotation]}`;
      return;
    }

    if (tool.type === 'erase') {
      previewIcon.innerHTML = eraseIcon();
      previewText.textContent = 'Erase';
      return;
    }

    previewIcon.innerHTML = '';
    previewText.textContent = 'No tool selected';
  }

  function render(): void {
    const { tool } = store.get();
    for (const [kind, button] of pieceButtons) {
      button.setAttribute(
        'aria-pressed',
        String(tool.type === 'place' && tool.kind === kind),
      );
    }
    eraseButton.setAttribute('aria-pressed', String(tool.type === 'erase'));
    rotateButton.disabled = tool.type !== 'place';
    renderPreview();
  }

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy(): void {
      unsubscribe();
      container.textContent = '';
    },
  };
}
