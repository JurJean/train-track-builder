import { routePath } from '../model/geometry';
import type { RoutedPath } from '../model/geometry';
import { hasClosedRoute, hasClosedLoop, primaryLoop, sameRouteSteps } from '../model/routes';
import type { Layout, PlacedPiece, Pose, Route, RouteStep } from '../model/types';
import { createSteam, drawCarriage, drawEngine, drawSteam, updateSteam } from '../render/train-art';
import type { Steam } from '../render/train-art';
import { carOpacity } from '../render/tunnel';
import {
  carPoses as trainCarPoses,
  createTrain,
  speedFromSlider,
  startTrain,
  stepTrain,
  stopTrain,
} from '../sim/train';
import type { TrainState } from '../sim/train';
import type { Board } from '../render/board';
import type { Editor } from './editor';
import { bus as defaultBus } from './events';
import type { EventBus } from './events';
import { onIntent } from './intents';
import type { Store } from './store';

/**
 * Wires the train simulation to the board, the editor and the store.
 *
 * On every `layout-changed` it refreshes `store.canGo` from `hasClosedLoop` and
 * checks that a running train's own loop is still intact; if a piece of that
 * loop is removed or rearranged the train eases to a stop and the app returns
 * to build mode. The `go`/`stop` intents start and park the train, and a board
 * layer draws the cars and the steam. Animation frames are only requested while
 * the train is moving or steam is still fading, so an idle board costs nothing.
 *
 * The geometry, motion and drawing all live in their own modules; this file is
 * just the glue.
 */

/** Board layer for the train, above the track but below build feedback. */
const TRAIN_Z = 15;
/**
 * Longest frame we advance by. A backgrounded tab hands us a huge gap; clamping
 * here (as `stepTrain` does again) means the train never teleports across the
 * map when the tab comes back.
 */
const FRAME_CLAMP = 0.05;

export interface TrainDebug {
  /** Live train state (a copy, so callers cannot corrupt the simulation). */
  state(): TrainState | null;
  /** Engine first, then the carriages, in world units. */
  carPoses(): Pose[];
  /** Arc length of the route, or 0 when no train is loaded. */
  length(): number;
  /** Whether the loaded path loops back on itself. */
  closed(): boolean;
  /** Pose at arc length `s` on the loaded route, or null. */
  poseAt(s: number): Pose | null;
  /** Shortest distance from a world point to the loaded route. */
  nearestDistance(x: number, y: number): number;
  /** The route the train is (or was last) running on. */
  routeSteps(): RouteStep[] | null;
  /** Current mode reported by the store. */
  mode(): string;
}

export interface TrainLoop {
  destroy(): void;
  readonly debug: TrainDebug;
}

export interface TrainLoopOptions {
  board: Board;
  editor: Editor;
  store: Store;
  /** Event bus carrying `layout-changed`; defaults to the shared bus. */
  bus?: EventBus;
}

export function createTrainLoop(options: TrainLoopOptions): TrainLoop {
  const { board, editor, store } = options;
  const bus = options.bus ?? defaultBus;

  let train: TrainState | null = null;
  let path: RoutedPath | null = null;
  let route: Route | null = null;
  const steam: Steam = createSteam();
  /** Tunnels in the current layout, refreshed only when the layout changes. */
  let tunnels: PlacedPiece[] = [];

  let rafId = 0;
  let lastNow = 0;

  function currentLayout(): Layout {
    return editor.layout();
  }

  function refreshTunnels(): void {
    tunnels = currentLayout().pieces.filter((piece) => piece.kind === 'tunnel');
  }

  function poses(): Pose[] {
    return train && path ? trainCarPoses(train, path) : [];
  }

  function isMoving(): boolean {
    return train !== null && (train.running || train.v > 0.0001);
  }

  function wantsFrames(): boolean {
    return isMoving() || steam.puffs.length > 0;
  }

  function ensureFrames(): void {
    if (rafId !== 0 || !wantsFrames()) return;
    lastNow = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopFrames(): void {
    if (rafId === 0) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function step(dt: number): void {
    if (!train || !path) return;
    const target = speedFromSlider(store.get().speed);
    stepTrain(train, path, dt, target);

    const cars = trainCarPoses(train, path);
    if (cars.length > 0) {
      updateSteam(steam, dt, cars[0], train.v, isMoving());
    }
  }

  function tick(now: number): void {
    rafId = 0;
    const dt = lastNow === 0 ? 0 : Math.min(FRAME_CLAMP, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;

    step(dt);
    board.markDirty();

    if (wantsFrames()) rafId = requestAnimationFrame(tick);
    else lastNow = 0;
  }

  function routeStillExists(layout: Layout): boolean {
    if (!route) return false;
    return hasClosedRoute(layout, route.steps);
  }

  /** Start (or resume) the train on the layout's primary loop. */
  function go(): void {
    const layout = currentLayout();
    const loop = primaryLoop(layout);
    if (!loop) return;

    if (train && route && sameRouteSteps(route.steps, loop.steps)) {
      // The same loop is still there: pull the parked train away again.
      startTrain(train);
    } else {
      train = createTrain();
      path = routePath(layout, loop);
      route = loop;
      steam.puffs.length = 0;
      steam.accumulator = 0;
      startTrain(train);
    }

    store.set({ mode: 'running' });
    bus.emit('train-started', {});
    lastNow = 0;
    ensureFrames();
    board.markDirty();
  }

  /** Ease the train to a halt and return to build mode. */
  function stop(): void {
    if (train) stopTrain(train);
    store.set({ mode: 'build' });
    bus.emit('train-stopped', {});
    ensureFrames();
    board.markDirty();
  }

  function onLayoutChanged(): void {
    const layout = currentLayout();
    refreshTunnels();
    store.set({ canGo: hasClosedLoop(layout) });

    // If the train's own loop no longer exists as a closed route, park it.
    // Edits anywhere else leave the running train alone.
    if (train && route && train.running && !routeStillExists(layout)) {
      stopTrain(train);
      store.set({ mode: 'build' });
      bus.emit('train-stopped', {});
      ensureFrames();
    }

    board.markDirty();
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!train || !path) return;
    const cars = trainCarPoses(train, path);

    ctx.save();
    for (let i = cars.length - 1; i >= 1; i -= 1) {
      const opacity = carOpacity(cars[i], tunnels);
      if (opacity <= 0.01) continue;
      ctx.globalAlpha = opacity;
      drawCarriage(ctx, cars[i], i - 1);
    }

    if (cars.length > 0) {
      const opacity = carOpacity(cars[0], tunnels);
      if (opacity > 0.01) {
        ctx.globalAlpha = opacity;
        drawEngine(ctx, cars[0]);
      }
    }

    ctx.globalAlpha = 1;
    drawSteam(ctx, steam);
    ctx.restore();
  }

  const removeLayer = board.addLayer(TRAIN_Z, draw);
  const offLayout = bus.on('layout-changed', onLayoutChanged);
  const offGo = onIntent('go', go);
  const offStop = onIntent('stop', stop);

  // Seed the tunnel list and `canGo` for the layout already in the editor.
  refreshTunnels();
  store.set({ canGo: hasClosedLoop(currentLayout()) });

  const debug: TrainDebug = {
    state: () => (train ? { ...train } : null),
    carPoses: poses,
    length: () => path?.length ?? 0,
    closed: () => path?.closed ?? false,
    poseAt: (s) => (path ? path.poseAt(s) : null),
    nearestDistance: (x, y) => {
      if (!path || path.length <= 0) return Infinity;
      const samples = Math.min(2000, Math.max(64, Math.ceil(path.length * 64)));
      let best = Infinity;
      for (let i = 0; i <= samples; i += 1) {
        const pose = path.poseAt((i / samples) * path.length);
        const dx = pose.x - x;
        const dy = pose.y - y;
        const distance = dx * dx + dy * dy;
        if (distance < best) best = distance;
      }
      return Math.sqrt(best);
    },
    routeSteps: () => (route ? route.steps.map((s) => ({ ...s })) : null),
    mode: () => store.get().mode,
  };

  return {
    debug,
    destroy(): void {
      stopFrames();
      removeLayer();
      offLayout();
      offGo();
      offStop();
    },
  };
}
