/**
 * Web Audio sound effects.
 *
 * Every sound is synthesised on the fly — there are no audio files. The module
 * subscribes to the shared {@link EventBus} (see `src/app/events.ts`) and turns
 * app events into sound, so no other module ever calls it directly.
 *
 * The `AudioContext` is created lazily the first time it is needed, typically
 * from a user gesture (a pointer or key event). Everything is wrapped in
 * try/catch: audio is a nicety, never a reason to crash the toy.
 *
 * Sound recipes (all scheduled relative to `ctx.currentTime`):
 * - `clack` (`piece-placed`, joined > 0): two short triangle "body" partials
 *   plus a band-passed white-noise click. Pitch and volume wobble ±6–10% per
 *   hit so repeated placements do not sound like a machine gun.
 * - `tap` (`piece-placed`, joined === 0): the same idea, quieter, shorter and
 *   a touch higher — a piece dropped on its own.
 * - `thunk` (`piece-removed`): a sine that drops 180 Hz → 70 Hz with a tiny
 *   low-passed noise puff, for a soft wooden knock.
 * - `tick` (`placement-rejected`): a barely-there, very quiet band-passed noise
 *   tick. Deliberately not a buzzer.
 * - `toot` (`train-started`): a friendly two-note whistle. Each note is a sine
 *   stack (1×, 2×, 3× partials) with a fast attack, gentle release and a small
 *   pitch dip at the end. The second toot follows after a short gap.
 * - `chuff` (`train-started` → `train-stopped`): an optional, very quiet
 *   low-passed noise puff repeated on a timer while the train runs.
 *
 * The mute flag is read once from `localStorage` under `ttb:muted` and can be
 * driven by the `mute-changed` event. In dev builds the live handle is exposed
 * as `window.__ttb.sfx` for QA (see `installSfx`).
 */
import { debugHandles } from '../app/debug';
import { bus as defaultBus } from '../app/events';
import type { EventBus } from '../app/events';
import { MUTED_KEY } from '../app/store';

/** Every sound the module can synthesise. */
export type SoundName = 'clack' | 'tap' | 'thunk' | 'tick' | 'toot' | 'chuff';

/** The object exposed to callers (and as `window.__ttb.sfx` in dev). */
export interface SfxHandle {
  /** Play a named sound, respecting the mute flag. */
  play(name: SoundName): void;
  clack(): void;
  tap(): void;
  thunk(): void;
  tick(): void;
  toot(): void;
  chuff(): void;
  /** Whether sound is currently muted. */
  isMuted(): boolean;
  /** Mute or unmute (stops the chuff loop when muting). */
  setMuted(muted: boolean): void;
  /** Stop timers and unsubscribe from the event bus. */
  destroy(): void;
}

export interface SfxOptions {
  /** Event bus to listen on. Defaults to the shared app bus. */
  bus?: EventBus;
  /**
   * Creates the `AudioContext` on demand. Return `null` when audio is
   * unavailable or blocked. Defaults to the browser `AudioContext`.
   */
  createContext?: () => AudioContext | null;
  /**
   * Storage used to read the initial mute flag. Pass `null` to disable
   * persistence entirely (handy in tests).
   */
  storage?: Pick<Storage, 'getItem'> | null;
  /** Master volume, clamped to 0..1. Defaults to a gentle `0.5`. */
  volume?: number;
  /** Subscribe to the bus automatically. Defaults to `true`. */
  autoWire?: boolean;
  /** Expose `window.__ttb.sfx` in dev builds. Defaults to `true`. */
  expose?: boolean;
}

const DEFAULT_VOLUME = 0.5;
/** Tiny lead so a sound scheduled at "now" is never in the past. */
const LEAD = 0.01;
/** Gap between the two toots, in seconds. */
const TOOT_GAP = 0.33;
/** How often the optional chuff loop puffs, in milliseconds. */
const CHUFF_INTERVAL = 380;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function defaultStorage(): SfxOptions['storage'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Access can throw (e.g. blocked cookies); fall back to no persistence.
    return null;
  }
}

function readMuted(storage: SfxOptions['storage']): boolean {
  try {
    return storage?.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function defaultCreateContext(): AudioContext | null {
  try {
    const ctor =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return ctor ? new ctor() : null;
  } catch {
    // Audio can be unavailable, blocked or constructed outside a gesture.
    return null;
  }
}

/**
 * Create (if needed) and pre-warm the audio graph, then listen for events.
 * Safe to call at load time: nothing is constructed until a sound plays or a
 * user gesture arrives.
 */
export function installSfx(options: SfxOptions = {}): SfxHandle {
  return createSfx(options);
}

export function createSfx(options: SfxOptions = {}): SfxHandle {
  const bus = options.bus ?? defaultBus;
  const createContext = options.createContext ?? defaultCreateContext;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const volume = clampVolume(options.volume ?? DEFAULT_VOLUME);
  const autoWire = options.autoWire ?? true;
  const expose = options.expose ?? true;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = readMuted(storage);
  let chuffTimer: ReturnType<typeof setInterval> | null = null;
  const unsubscribers: Array<() => void> = [];

  // --- small, defensive audio helpers -------------------------------------

  function resumeContext(context: AudioContext): void {
    try {
      if (context.state !== 'suspended') return;
      const result = context.resume();
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // Some browsers throw when resuming outside a gesture; ignore.
    }
  }

  function makeNoiseBuffer(context: AudioContext): AudioBuffer | null {
    try {
      const sampleRate = context.sampleRate || 44100;
      const length = Math.max(1, Math.floor(sampleRate * 0.4));
      const buffer = context.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return buffer;
    } catch {
      return null;
    }
  }

  function ensureContext(): AudioContext | null {
    if (ctx) {
      resumeContext(ctx);
      return ctx;
    }
    const context = createContext();
    if (!context) return null;
    try {
      const gain = context.createGain();
      gain.gain.value = muted ? 0 : volume;
      gain.connect(context.destination);
      ctx = context;
      master = gain;
      noise = makeNoiseBuffer(context);
      resumeContext(context);
      return context;
    } catch {
      ctx = null;
      master = null;
      noise = null;
      return null;
    }
  }

  function applyMute(): void {
    if (!ctx || !master) return;
    const target = muted ? 0 : volume;
    try {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(target, now, 0.02);
    } catch {
      try {
        master.gain.value = target;
      } catch {
        // Nothing else we can do; stay silent rather than throw.
      }
    }
  }

  /** A decaying pitched body (triangle by default). */
  function tone(
    context: AudioContext,
    out: AudioNode,
    when: number,
    freq: number,
    duration: number,
    peak: number,
    type: OscillatorType = 'triangle',
  ): void {
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(peak, 0.0001), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  /** A short filtered burst of white noise — the "click"/"puff" component. */
  function noiseBurst(
    context: AudioContext,
    out: AudioNode,
    when: number,
    opts: { duration: number; peak: number; freq: number; q?: number; type?: BiquadFilterType },
  ): void {
    if (!noise) return;
    const start = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq, start);
    filter.Q.setValueAtTime(opts.q ?? 0.7, start);
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(opts.peak, 0.0001), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(start);
    source.stop(start + opts.duration + 0.02);
  }

  // --- individual sounds ---------------------------------------------------

  function playClack(context: AudioContext, out: AudioNode, when: number): void {
    const pitch = 1 + (Math.random() - 0.5) * 0.12;
    const level = 0.85 + (Math.random() - 0.5) * 0.2;
    tone(context, out, when, 188 * pitch, 0.11, 0.3 * level);
    tone(context, out, when, 297 * pitch, 0.075, 0.14 * level);
    noiseBurst(context, out, when, {
      duration: 0.05,
      peak: 0.3 * level,
      freq: 1900 * pitch,
      q: 0.7,
    });
  }

  function playTap(context: AudioContext, out: AudioNode, when: number): void {
    const pitch = 1 + (Math.random() - 0.5) * 0.14;
    const level = 0.5 + (Math.random() - 0.5) * 0.2;
    tone(context, out, when, 340 * pitch, 0.05, 0.11 * level);
    noiseBurst(context, out, when, {
      duration: 0.035,
      peak: 0.16 * level,
      freq: 1450 * pitch,
      q: 0.6,
    });
  }

  function playThunk(context: AudioContext, out: AudioNode, when: number): void {
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, start);
    osc.frequency.exponentialRampToValueAtTime(70, start + 0.16);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.34, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(start + 0.24);
    noiseBurst(context, out, when, {
      duration: 0.12,
      peak: 0.1,
      freq: 380,
      q: 0.5,
      type: 'lowpass',
    });
  }

  function playTick(context: AudioContext, out: AudioNode, when: number): void {
    noiseBurst(context, out, when, { duration: 0.02, peak: 0.045, freq: 3200, q: 1.2 });
  }

  function playNote(
    context: AudioContext,
    out: AudioNode,
    when: number,
    freq: number,
    duration: number,
  ): void {
    const start = context.currentTime + when;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(1, start + 0.035);
    env.gain.setValueAtTime(1, start + duration - 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    env.connect(out);

    const partials = [
      { ratio: 1, level: 0.26 },
      { ratio: 2, level: 0.07 },
      { ratio: 3, level: 0.03 },
    ];
    for (const partial of partials) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * partial.ratio, start);
      osc.frequency.setValueAtTime(freq * partial.ratio, start + duration - 0.06);
      osc.frequency.exponentialRampToValueAtTime(
        freq * partial.ratio * 0.985,
        start + duration,
      );
      const gain = context.createGain();
      gain.gain.setValueAtTime(partial.level, start);
      osc.connect(gain);
      gain.connect(env);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }
  }

  function playToot(context: AudioContext, out: AudioNode, when: number): void {
    playNote(context, out, when, 659.25, 0.24);
    playNote(context, out, when + TOOT_GAP, 659.25, 0.26);
  }

  function playChuff(context: AudioContext, out: AudioNode, when: number): void {
    noiseBurst(context, out, when, {
      duration: 0.085,
      peak: 0.05,
      freq: 520,
      q: 0.4,
      type: 'lowpass',
    });
  }

  function render(name: SoundName, context: AudioContext, out: AudioNode): void {
    switch (name) {
      case 'clack':
        playClack(context, out, LEAD);
        break;
      case 'tap':
        playTap(context, out, LEAD);
        break;
      case 'thunk':
        playThunk(context, out, LEAD);
        break;
      case 'tick':
        playTick(context, out, LEAD);
        break;
      case 'toot':
        playToot(context, out, LEAD);
        break;
      case 'chuff':
        playChuff(context, out, LEAD);
        break;
    }
  }

  // --- public API ----------------------------------------------------------

  function play(name: SoundName): void {
    if (muted) return;
    const context = ensureContext();
    if (!context || !master) return;
    try {
      render(name, context, master);
    } catch {
      // A failed sound must never break the app.
    }
  }

  function stopChuff(): void {
    if (chuffTimer !== null) {
      clearInterval(chuffTimer);
      chuffTimer = null;
    }
  }

  function startChuff(): void {
    if (muted || chuffTimer !== null) return;
    const context = ensureContext();
    if (!context) return;
    chuffTimer = setInterval(() => {
      if (muted || !ctx) {
        stopChuff();
        return;
      }
      try {
        playChuff(ctx, master as AudioNode, LEAD);
      } catch {
        // Ignore a single failed puff.
      }
    }, CHUFF_INTERVAL);
  }

  function setMuted(next: boolean): void {
    muted = next;
    if (muted) stopChuff();
    applyMute();
  }

  const handle: SfxHandle = {
    play,
    clack: () => play('clack'),
    tap: () => play('tap'),
    thunk: () => play('thunk'),
    tick: () => play('tick'),
    toot: () => play('toot'),
    chuff: () => play('chuff'),
    isMuted: () => muted,
    setMuted,
    destroy(): void {
      stopChuff();
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    },
  };

  // Pre-warm the context on the first user gesture. This keeps load silent and
  // avoids the browser's "AudioContext was not allowed to start" warning.
  if (typeof document !== 'undefined') {
    const onGesture = (): void => {
      ensureContext();
    };
    const once: AddEventListenerOptions = { once: true };
    document.addEventListener('pointerdown', onGesture, { ...once, passive: true });
    document.addEventListener('keydown', onGesture, once);
    document.addEventListener('touchstart', onGesture, { ...once, passive: true });
  }

  if (autoWire) {
    unsubscribers.push(
      bus.on('piece-placed', ({ joined }) => play(joined > 0 ? 'clack' : 'tap')),
      bus.on('piece-removed', () => play('thunk')),
      bus.on('placement-rejected', () => play('tick')),
      bus.on('train-started', () => {
        play('toot');
        startChuff();
      }),
      bus.on('train-stopped', () => stopChuff()),
      bus.on('mute-changed', ({ muted: next }) => setMuted(next)),
    );
  }

  if (expose) {
    const handles = debugHandles();
    if (handles) handles.sfx = handle;
  }

  return handle;
}
