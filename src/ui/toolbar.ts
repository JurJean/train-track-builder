import { bus } from '../app/events';
import { fireIntent } from '../app/intents';
import type { Store } from '../app/store';

export interface Toolbar {
  destroy(): void;
}

/**
 * Builds the `#toolbar`: Undo/Redo, the big Go!/Stop button, a labelled speed
 * slider and a mute toggle. The controls reflect the store and either update it
 * or announce an intent — they never drive the board or simulation directly.
 */
export function createToolbar(container: HTMLElement, store: Store): Toolbar {
  container.textContent = '';

  const history = document.createElement('div');
  history.className = 'toolbar-group';

  const undoButton = document.createElement('button');
  undoButton.type = 'button';
  undoButton.id = 'undo-btn';
  undoButton.className = 'toolbar-button';
  undoButton.textContent = 'Undo';
  undoButton.addEventListener('click', () => fireIntent('undo'));

  const redoButton = document.createElement('button');
  redoButton.type = 'button';
  redoButton.id = 'redo-btn';
  redoButton.className = 'toolbar-button';
  redoButton.textContent = 'Redo';
  redoButton.addEventListener('click', () => fireIntent('redo'));

  history.append(undoButton, redoButton);

  const play = document.createElement('div');
  play.className = 'toolbar-group toolbar-play';

  const goButton = document.createElement('button');
  goButton.type = 'button';
  goButton.id = 'go-btn';
  goButton.className = 'go-btn';
  goButton.textContent = 'Go!';
  goButton.setAttribute('aria-describedby', 'go-hint');
  goButton.addEventListener('click', () => {
    if (store.get().mode === 'running') {
      store.set({ mode: 'build' });
      fireIntent('stop');
    } else {
      store.set({ mode: 'running' });
      fireIntent('go');
    }
  });

  const goHint = document.createElement('span');
  goHint.id = 'go-hint';
  goHint.className = 'go-hint';
  goHint.textContent = 'Close the loop to go';

  play.append(goButton, goHint);

  const speedGroup = document.createElement('div');
  speedGroup.className = 'toolbar-group toolbar-speed';

  const speedLabel = document.createElement('label');
  speedLabel.htmlFor = 'speed';
  speedLabel.textContent = 'Speed';

  const speed = document.createElement('input');
  speed.type = 'range';
  speed.id = 'speed';
  speed.min = '0';
  speed.max = '1';
  speed.step = '0.01';
  speed.value = '0.4';
  speed.setAttribute('aria-describedby', 'speed-value');
  speed.addEventListener('input', () => {
    store.set({ speed: Number(speed.value) });
  });

  const speedValue = document.createElement('output');
  speedValue.id = 'speed-value';
  speedValue.className = 'speed-value';
  speedValue.setAttribute('for', 'speed');

  speedGroup.append(speedLabel, speed, speedValue);

  const muteButton = document.createElement('button');
  muteButton.type = 'button';
  muteButton.id = 'mute-btn';
  muteButton.className = 'toolbar-button mute-button';
  muteButton.addEventListener('click', () => {
    const muted = !store.get().muted;
    store.set({ muted });
    bus.emit('mute-changed', { muted });
  });

  container.append(history, play, speedGroup, muteButton);

  function render(): void {
    const state = store.get();

    undoButton.disabled = !state.canUndo;
    undoButton.title = state.canUndo ? 'Undo the last change (Ctrl+Z)' : 'Nothing to undo yet';
    redoButton.disabled = !state.canRedo;
    redoButton.title = state.canRedo
      ? 'Redo the last undone change (Ctrl+Shift+Z)'
      : 'Nothing to redo yet';

    const running = state.mode === 'running';
    goButton.textContent = running ? 'Stop' : 'Go!';
    goButton.disabled = running ? false : !state.canGo;
    goButton.classList.toggle('go-ready', !running && state.canGo);
    goHint.hidden = running || state.canGo;

    const speedText = String(state.speed);
    if (speed.value !== speedText) speed.value = speedText;
    speedValue.textContent = `${Math.round(state.speed * 100)}%`;

    muteButton.setAttribute('aria-pressed', String(state.muted));
    muteButton.textContent = state.muted ? 'Sound off' : 'Sound on';
    muteButton.title = state.muted ? 'Turn sound on' : 'Mute sound';
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
