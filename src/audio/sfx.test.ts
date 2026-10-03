import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../app/events';
import { MUTED_KEY } from '../app/store';
import { createSfx } from './sfx';
import type { SfxHandle } from './sfx';

// --- a tiny, hand-rolled Web Audio mock ------------------------------------
//
// It only implements what `sfx.ts` touches, and returns the destination from
// `connect` so the module can chain `.connect(a).connect(b)` like the real API.

class FakeParam {
  value = 0;
  events: Array<{ type: string; value: number; time: number }> = [];

  setValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: 'exp', value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeParam {
    this.events.push({ type: 'cancel', value: 0, time });
    return this;
  }

  setTargetAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: 'target', value, time });
    return this;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam();
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeBiquadFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

interface FakeCounts {
  oscillators: number;
  bufferSources: number;
  gains: number;
  filters: number;
}

interface FakeContext {
  context: AudioContext;
  counts: FakeCounts;
}

function makeContext(): FakeContext {
  const counts: FakeCounts = { oscillators: 0, bufferSources: 0, gains: 0, filters: 0 };

  const fake = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running' as AudioContextState,
    destination: new FakeNode(),
    createGain(): FakeGain {
      counts.gains += 1;
      return new FakeGain();
    },
    createOscillator(): FakeOscillator {
      counts.oscillators += 1;
      return new FakeOscillator();
    },
    createBufferSource(): FakeBufferSource {
      counts.bufferSources += 1;
      return new FakeBufferSource();
    },
    createBiquadFilter(): FakeBiquadFilter {
      counts.filters += 1;
      return new FakeBiquadFilter();
    },
    createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
      return {
        length,
        sampleRate,
        duration: sampleRate > 0 ? length / sampleRate : 0,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(length),
      } as unknown as AudioBuffer;
    },
    resume(): Promise<void> {
      this.state = 'running';
      return Promise.resolve();
    },
    close(): Promise<void> {
      this.state = 'closed';
      return Promise.resolve();
    },
  };

  return { context: fake as unknown as AudioContext, counts };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) as string) : null;
    },
  };
}

const activeHandles: SfxHandle[] = [];

/** Build an sfx handle wired to a fresh bus and mock context. */
function setup(
  options: {
    storage?: { getItem(key: string): string | null } | null;
  } = {},
): { sfx: SfxHandle; bus: ReturnType<typeof createEventBus>; counts: FakeCounts } {
  const bus = createEventBus();
  const { context, counts } = makeContext();
  const sfx = createSfx({
    bus,
    createContext: () => context,
    storage: options.storage === undefined ? null : options.storage,
    expose: false,
  });
  activeHandles.push(sfx);
  return { sfx, bus, counts };
}

afterEach(() => {
  while (activeHandles.length > 0) activeHandles.pop()?.destroy();
  vi.useRealTimers();
});

describe('createSfx event wiring', () => {
  it('plays a wooden clack when a placed piece joined something', () => {
    const { bus, counts } = setup();

    bus.emit('piece-placed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
      joined: 2,
    });

    // Two triangle body partials plus one noise click.
    expect(counts.oscillators).toBe(2);
    expect(counts.bufferSources).toBe(1);
    expect(counts.filters).toBe(1);
  });

  it('plays a softer tap when the piece joined nothing', () => {
    const { bus, counts } = setup();

    bus.emit('piece-placed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
      joined: 0,
    });

    expect(counts.oscillators).toBe(1);
    expect(counts.bufferSources).toBe(1);
  });

  it('plays a soft thunk when a piece is removed', () => {
    const { bus, counts } = setup();

    bus.emit('piece-removed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
    });

    expect(counts.oscillators).toBe(1);
    expect(counts.bufferSources).toBe(1);
    expect(counts.filters).toBe(1);
  });

  it('plays only a barely-there tick when a placement is rejected', () => {
    const { bus, counts } = setup();

    bus.emit('placement-rejected', { reason: 'overlap' });

    expect(counts.oscillators).toBe(0);
    expect(counts.bufferSources).toBe(1);
  });

  it('plays a two-note toot when the train starts', () => {
    const { bus, counts } = setup();

    bus.emit('train-started', {});

    // Two notes, each a stack of three sine partials.
    expect(counts.oscillators).toBe(6);
    expect(counts.bufferSources).toBe(0);
  });
});

describe('createSfx chuff loop', () => {
  it('puffs quietly while running and stops on train-stopped', () => {
    vi.useFakeTimers();
    const { bus, counts } = setup();

    bus.emit('train-started', {});
    const afterToot = counts.bufferSources;

    vi.advanceTimersByTime(1000);
    expect(counts.bufferSources).toBeGreaterThan(afterToot);

    bus.emit('train-stopped', {});
    const afterStop = counts.bufferSources;
    vi.advanceTimersByTime(2000);
    expect(counts.bufferSources).toBe(afterStop);
  });
});

describe('createSfx mute', () => {
  it('reads the initial mute flag from localStorage', () => {
    const { sfx } = setup({ storage: fakeStorage({ [MUTED_KEY]: 'true' }) });
    expect(sfx.isMuted()).toBe(true);
  });

  it('defaults to unmuted when storage is missing or empty', () => {
    const { sfx } = setup({ storage: null });
    expect(sfx.isMuted()).toBe(false);
  });

  it('stays silent while muted, even before any audio is created', () => {
    const { bus, counts } = setup({ storage: fakeStorage({ [MUTED_KEY]: 'true' }) });

    bus.emit('piece-placed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
      joined: 1,
    });
    bus.emit('piece-removed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
    });
    bus.emit('train-started', {});

    expect(counts.oscillators).toBe(0);
    expect(counts.bufferSources).toBe(0);
  });

  it('mute-changed silences later sounds and unmute restores them', () => {
    const { sfx, bus, counts } = setup();

    sfx.setMuted(true);
    bus.emit('piece-placed', {
      piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
      joined: 1,
    });
    expect(counts.oscillators).toBe(0);

    bus.emit('mute-changed', { muted: false });
    bus.emit('piece-placed', {
      piece: { id: 'p2', kind: 'straight', origin: { x: 1, y: 0 }, rotation: 0 },
      joined: 1,
    });
    expect(counts.oscillators).toBeGreaterThan(0);
  });

  it('muting stops an already-running chuff loop', () => {
    vi.useFakeTimers();
    const { bus, counts } = setup();

    bus.emit('train-started', {});
    bus.emit('mute-changed', { muted: true });
    const afterMute = counts.bufferSources;
    vi.advanceTimersByTime(2000);
    expect(counts.bufferSources).toBe(afterMute);
  });
});

describe('createSfx audio availability', () => {
  it('never throws when no AudioContext is available', () => {
    const bus = createEventBus();
    const sfx = createSfx({ bus, createContext: () => null, storage: null, expose: false });
    activeHandles.push(sfx);

    expect(() => {
      bus.emit('piece-placed', {
        piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
        joined: 3,
      });
      bus.emit('piece-placed', {
        piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
        joined: 0,
      });
      bus.emit('piece-removed', {
        piece: { id: 'p1', kind: 'straight', origin: { x: 0, y: 0 }, rotation: 0 },
      });
      bus.emit('placement-rejected', { reason: 'overlap' });
      bus.emit('train-started', {});
      bus.emit('train-stopped', {});
      bus.emit('mute-changed', { muted: true });
      sfx.play('clack');
      sfx.chuff();
    }).not.toThrow();
  });

  it('constructs without touching the DOM or audio (safe on load)', () => {
    expect(() => {
      const sfx = createSfx({ expose: false });
      sfx.destroy();
    }).not.toThrow();
  });
});
