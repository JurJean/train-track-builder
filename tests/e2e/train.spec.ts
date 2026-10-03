import { expect, test, type Page } from '@playwright/test';

/**
 * Issue #12 — Go! The train runs round your loop.
 *
 * These tests drive the real app on `/?demo=oval` (a closed loop with a
 * station, a bridge and a tunnel) and read the dev handle `window.__ttb.train`
 * to sample the simulation.
 */

interface Pose {
  x: number;
  y: number;
  heading: number;
}

interface TrainState {
  s: number;
  v: number;
  running: boolean;
  carriages: number;
  carLength: number;
  gap: number;
}

interface RouteStep {
  pieceId: string;
  from: number;
  to: number;
}

/** Snapshot of the debug handle, evaluated inside the page. */
interface TrainSnapshot {
  state: TrainState | null;
  poses: Pose[];
  length: number;
  routeSteps: RouteStep[] | null;
  canGo: boolean;
  mode: string;
}

const CANVAS = '#board-canvas';

async function snapshot(page: Page): Promise<TrainSnapshot> {
  return page.evaluate(() => {
    interface Debug {
      state(): TrainState | null;
      carPoses(): Pose[];
      length(): number;
      routeSteps(): RouteStep[] | null;
    }
    const handles = (
      window as unknown as {
        __ttb?: { train?: Debug; store?: { get(): { canGo: boolean; mode: string } } };
      }
    ).__ttb;
    if (!handles?.train) throw new Error('window.__ttb.train is not registered');
    return {
      state: handles.train.state(),
      poses: handles.train.carPoses(),
      length: handles.train.length(),
      routeSteps: handles.train.routeSteps(),
      canGo: handles.store?.get().canGo ?? false,
      mode: handles.store?.get().mode ?? 'build',
    };
  });
}

/** Sample the train over `count` animation frames, in page order. */
async function sampleFrames(
  page: Page,
  count: number,
): Promise<Array<{ s: number; poses: Pose[] }>> {
  return page.evaluate(async (frames) => {
    interface Debug {
      state(): { s: number } | null;
      carPoses(): Pose[];
    }
    const train = (window as unknown as { __ttb?: { train?: Debug } }).__ttb?.train;
    if (!train) throw new Error('window.__ttb.train is not registered');

    const samples: Array<{ s: number; poses: Pose[] }> = [];
    await new Promise<void>((resolve) => {
      let seen = 0;
      const step = (): void => {
        const state = train.state();
        samples.push({ s: state?.s ?? 0, poses: train.carPoses() });
        seen += 1;
        if (seen >= frames) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return samples;
  }, count);
}

/** Page coordinates of a cell centre, using the debug view handle. */
async function cellToPage(page: Page, cell: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  const local = await page.evaluate((value) => {
    const view = (
      window as unknown as {
        __ttb?: { view?: { cellToScreen(c: { x: number; y: number }): { x: number; y: number } } };
      }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');
    return view.cellToScreen(value);
  }, cell);
  return { x: (box?.x ?? 0) + local.x, y: (box?.y ?? 0) + local.y };
}

/** Zoom the board onto the demo loop so screenshots are legible. */
async function zoomToDemo(page: Page): Promise<void> {
  const centre = await cellToPage(page, { x: 16, y: 12 });
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -500);
  await page.waitForTimeout(150);
}

/** Screenshot just the demo loop's neighbourhood, and attach it. */
async function shotDemo(page: Page, testInfo: import('@playwright/test').TestInfo, name: string): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  const topLeft = await cellToPage(page, { x: 13, y: 10 });
  const bottomRight = await cellToPage(page, { x: 19, y: 14 });
  const pad = 80;
  const clipX = Math.max(box?.x ?? 0, Math.min(topLeft.x, bottomRight.x) - pad);
  const clipY = Math.max(box?.y ?? 0, Math.min(topLeft.y, bottomRight.y) - pad);
  const clip = {
    x: clipX,
    y: clipY,
    width:
      Math.min((box?.x ?? 0) + (box?.width ?? 0), Math.max(topLeft.x, bottomRight.x) + pad) -
      clipX,
    height:
      Math.min((box?.y ?? 0) + (box?.height ?? 0), Math.max(topLeft.y, bottomRight.y) + pad) -
      clipY,
  };
  const path = `docs/screenshots/issue-12/${name}.png`;
  await page.screenshot({ path, clip });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('Go! — the train runs round your loop', () => {
  test('with ?demo=oval, Go! is enabled', async ({ page }, testInfo) => {
    await page.goto('/?demo=oval');

    const go = page.locator('#go-btn');
    await expect(go).toBeEnabled();
    await expect(go).toHaveText('Go!');
    await expect(go).toHaveClass(/go-ready/);

    const state = await snapshot(page);
    expect(state.canGo).toBe(true);

    await zoomToDemo(page);
    const path = 'docs/screenshots/issue-12/demo-ready.png';
    await page.screenshot({ path });
    await testInfo.attach('demo-ready', { path, contentType: 'image/png' });
  });

  test('pressing Go! moves the train and the poses stay on the route', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.evaluate(() => {
      (window as unknown as { __ttb?: { store?: { set(p: unknown): void } } }).__ttb?.store?.set(
        { speed: 1 },
      );
    });

    await page.locator('#go-btn').click();
    await expect(page.locator('#go-btn')).toHaveText('Stop');

    const samples = await sampleFrames(page, 60);
    expect(samples.length).toBe(60);

    // The train actually moved: the engine travels across the loop.
    let travelled = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1].poses[0];
      const b = samples[i].poses[0];
      travelled += Math.hypot(b.x - a.x, b.y - a.y);
    }
    expect(travelled).toBeGreaterThan(0.2);

    // Every car stays close to the rails, and no pose is NaN.
    for (const sample of samples) {
      expect(sample.poses.length).toBe(3); // engine + two carriages
      for (const pose of sample.poses) {
        expect(Number.isFinite(pose.x)).toBe(true);
        expect(Number.isFinite(pose.y)).toBe(true);
        expect(Number.isFinite(pose.heading)).toBe(true);
        const distance = await page.evaluate(
          (p) => {
            const train = (
              window as unknown as { __ttb?: { train?: { nearestDistance(x: number, y: number): number } } }
            ).__ttb?.train;
            return train?.nearestDistance(p.x, p.y) ?? Infinity;
          },
          { x: pose.x, y: pose.y },
        );
        expect(distance).toBeLessThan(0.4);
      }
    }
  });

  test('Stop brings the train to rest, parked where it stopped', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.locator('#go-btn').click();
    await expect(page.locator('#go-btn')).toHaveText('Stop');

    // Let it get going.
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(0.3);

    await page.locator('#go-btn').click();
    await expect(page.locator('#go-btn')).toHaveText('Go!');

    // It eases to a halt rather than snapping.
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0, { timeout: 5000 })
      .toBeLessThan(0.001);

    const rested = await snapshot(page);
    expect(rested.mode).toBe('build');
    expect(rested.state?.running).toBe(false);

    // Parked: the position does not drift afterwards.
    await page.waitForTimeout(250);
    const later = await snapshot(page);
    expect(Math.abs((later.state?.s ?? 0) - (rested.state?.s ?? 0))).toBeLessThan(0.001);
  });

  test('removing a piece of the loop stops the train and disables Go!', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.locator('#go-btn').click();
    await expect(page.locator('#go-btn')).toHaveText('Stop');
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(0.3);

    // Pull out a piece the train's loop depends on.
    await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __ttb?: {
            editor?: {
              layout(): { pieces: Array<{ kind: string; origin: { x: number; y: number } }> };
              removeAt(cell: { x: number; y: number }): unknown;
            };
          };
        }
      ).__ttb?.editor;
      if (!editor) throw new Error('window.__ttb.editor is not registered');
      const bridge = editor.layout().pieces.find((piece) => piece.kind === 'bridge');
      if (!bridge) throw new Error('demo loop has no bridge to remove');
      editor.removeAt(bridge.origin);
    });

    await expect(page.locator('#go-btn')).toBeDisabled();
    await expect(page.locator('#go-btn')).toHaveText('Go!');
    await expect.poll(async () => (await snapshot(page)).canGo).toBe(false);
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0, { timeout: 5000 })
      .toBeLessThan(0.001);
    await expect.poll(async () => (await snapshot(page)).mode).toBe('build');
  });

  test('edits elsewhere do not disturb a running train', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.locator('#go-btn').click();
    await expect(page.locator('#go-btn')).toHaveText('Stop');
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(0.3);

    // Add an unrelated loop far from the demo: the train's own route is intact.
    await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __ttb?: {
            editor?: { place(kind: string, origin: { x: number; y: number }, rotation: number): unknown };
          };
        }
      ).__ttb?.editor;
      const loop: Array<[string, number, number, number]> = [
        ['curve-sharp', 0, 0, 0],
        ['curve-sharp', 1, 0, 1],
        ['curve-sharp', 1, 1, 2],
        ['curve-sharp', 0, 1, 3],
      ];
      for (const [kind, x, y, rotation] of loop) {
        editor?.place(kind, { x: 2 + x, y: 2 + y }, rotation);
      }
    });

    // Still running.
    await expect(page.locator('#go-btn')).toHaveText('Stop');
    expect((await snapshot(page)).mode).toBe('running');
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(0.3);
  });

  test('poses stay continuous at 60 fps, with no jumps at piece joins', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.evaluate(() => {
      (window as unknown as { __ttb?: { store?: { set(p: unknown): void } } }).__ttb?.store?.set(
        { speed: 1 },
      );
    });
    await page.locator('#go-btn').click();
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(1);

    const samples = await sampleFrames(page, 120);
    const length = (await snapshot(page)).length;

    let maxStep = 0;
    let maxTurn = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1].poses;
      const current = samples[i].poses;
      for (let car = 0; car < current.length; car += 1) {
        const a = previous[car];
        const b = current[car];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        // A closed route wraps; treat that as the tiny wrap step it is.
        if (Math.hypot(dx, dy) > length / 2) {
          // Should not happen for a clamped frame; keep it explicit.
          dx = 0;
          dy = 0;
        }
        maxStep = Math.max(maxStep, Math.hypot(dx, dy));

        let turn = Math.abs(b.heading - a.heading);
        if (turn > Math.PI) turn = Math.abs(turn - 2 * Math.PI);
        maxTurn = Math.max(maxTurn, turn);
      }
    }

    // At the top speed (4 cells/s) one clamped frame is 0.2 cells. A carriage
    // straddling a corner can pivot, so allow a modest turn per frame too.
    expect(maxStep).toBeLessThan(0.3);
    expect(maxTurn).toBeLessThan(0.6);
  });

  test('a hidden-tab gap does not teleport the train', async ({ page }) => {
    await page.goto('/?demo=oval');
    await page.evaluate(() => {
      (window as unknown as { __ttb?: { store?: { set(p: unknown): void } } }).__ttb?.store?.set(
        { speed: 1 },
      );
    });
    await page.locator('#go-btn').click();
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0)
      .toBeGreaterThan(0.8);

    const result = await page.evaluate(async () => {
      interface TrainDebug {
        state(): { s: number; v: number } | null;
        length(): number;
      }
      const train = (window as unknown as { __ttb?: { train?: TrainDebug } }).__ttb?.train;
      if (!train) throw new Error('window.__ttb.train is not registered');

      const native = window.requestAnimationFrame.bind(window);
      const held: FrameRequestCallback[] = [];
      window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
        held.push(callback);
        return 0;
      };

      const before = train.state()?.s ?? 0;
      const length = train.length();
      // A hidden tab gives the page no frames for a while.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const heldCount = held.length;

      // The tab comes back: run the queued frames with a far-future timestamp.
      window.requestAnimationFrame = native;
      const future = performance.now() + 5000;
      for (const callback of held) callback(future);
      await new Promise<void>((resolve) => native(() => resolve()));

      const after = train.state()?.s ?? 0;
      const raw = Math.abs(after - before);
      const wrapped = Math.min(raw, length - raw);
      return { wrapped, heldCount, length };
    });

    expect(result.heldCount).toBeGreaterThan(0);
    // One clamped step at 4 cells/s is 0.2 cells, so anything near 5 s of
    // travel (20 cells) would be a teleport.
    expect(result.wrapped).toBeLessThan(0.6);
  });

  test('frame times stay smooth while the demo runs', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/?demo=oval');
    await page.evaluate(() => {
      (window as unknown as { __ttb?: { store?: { set(p: unknown): void } } }).__ttb?.store?.set(
        { speed: 1 },
      );
    });
    await page.locator('#go-btn').click();

    const intervals = await page.evaluate(async () => {
      const out: number[] = [];
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let frames = 0;
        const step = (now: number): void => {
          out.push(now - last);
          last = now;
          frames += 1;
          if (frames >= 150) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return out;
    });

    const sorted = [...intervals].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    expect(p95).toBeLessThan(50);
    expect(max).toBeLessThan(250);

    // Only request frames while the train moves: after stopping, easing to
    // rest and the steam fading, the board should settle and stop redrawing.
    await page.locator('#go-btn').click();
    await expect
      .poll(async () => (await snapshot(page)).state?.v ?? 0, { timeout: 10000 })
      .toBeLessThan(0.001);
    await page.waitForTimeout(1800); // let any last steam puffs fade

    const before = await page.evaluate(
      () => (window as unknown as { __ttb?: { view?: { frames: number } } }).__ttb?.view?.frames ?? 0,
    );
    await page.waitForTimeout(400);
    const after = await page.evaluate(
      () => (window as unknown as { __ttb?: { view?: { frames: number } } }).__ttb?.view?.frames ?? 0,
    );
    expect(after).toBe(before);

    await zoomToDemo(page);
    await shotDemo(page, testInfo, 'train-running');

    expect(errors).toEqual([]);
  });
});
