import { expect, test, type Page } from '@playwright/test';

interface CameraState {
  x: number;
  y: number;
  scale: number;
}

const canvas = '#board-canvas';

async function cameraOf(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const view = (
      window as unknown as { __ttb?: { view?: { camera: CameraState } } }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');
    return { ...view.camera };
  });
}

async function framesOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (
      window as unknown as { __ttb?: { view?: { frames: number } } }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');
    return view.frames;
  });
}

test.describe('device pixel ratio 1', () => {
  test.use({ deviceScaleFactor: 1 });

  test('sizes the canvas backing store crisply and tracks resizes', async ({ page }) => {
    await page.goto('/');
    const board = page.locator(canvas);
    await expect(board).toBeVisible();

    const first = await board.boundingBox();
    expect(first).not.toBeNull();
    const firstSize = await board.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
      dpr: window.devicePixelRatio,
    }));
    expect(firstSize.dpr).toBe(1);
    expect(firstSize.width).toBe(Math.round((first?.width ?? 0) * 1));
    expect(firstSize.height).toBe(Math.round((first?.height ?? 0) * 1));

    await page.setViewportSize({ width: 900, height: 650 });
    await expect
      .poll(async () => {
        const box = await board.boundingBox();
        const size = await board.evaluate((element) => ({
          width: (element as HTMLCanvasElement).width,
          height: (element as HTMLCanvasElement).height,
          dpr: window.devicePixelRatio,
        }));
        return (
          box !== null &&
          size.width === Math.round(box.width * size.dpr) &&
          size.height === Math.round(box.height * size.dpr)
        );
      })
      .toBe(true);
  });
});

test.describe('device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('uses a 2x backing store', async ({ page }) => {
    await page.goto('/');
    const board = page.locator(canvas);
    const box = await board.boundingBox();
    const size = await board.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
      dpr: window.devicePixelRatio,
    }));

    expect(size.dpr).toBe(2);
    expect(size.width).toBe(Math.round((box?.width ?? 0) * 2));
    expect(size.height).toBe(Math.round((box?.height ?? 0) * 2));
  });
});

test('stops drawing while idle and draws again on change', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(250);

  const before = await framesOf(page);
  await page.waitForTimeout(400);
  expect(await framesOf(page)).toBe(before);

  const board = page.locator(canvas);
  const box = await board.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 80, (box?.y ?? 0) + 80);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => framesOf(page)).toBeGreaterThan(before);
});

test('zooms around the cursor, keeping the point under it fixed', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(() => {
    const view = (
      window as unknown as {
        __ttb?: {
          view?: { camera: CameraState };
        };
      }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');

    const target = document.querySelector('#board-canvas') as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    const local = { x: Math.round(rect.width * 0.35), y: Math.round(rect.height * 0.6) };

    const before = { ...view.camera };
    const world = (camera: CameraState) => ({
      x: (local.x - camera.x) / camera.scale,
      y: (local.y - camera.y) / camera.scale,
    });
    const worldBefore = world(before);

    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -500,
        clientX: rect.left + local.x,
        clientY: rect.top + local.y,
        bubbles: true,
        cancelable: true,
      }),
    );

    const after = { ...view.camera };
    return { before, after, worldBefore, worldAfter: world(after) };
  });

  expect(result.after.scale).toBeGreaterThan(result.before.scale);
  expect(result.worldAfter.x).toBeCloseTo(result.worldBefore.x, 6);
  expect(result.worldAfter.y).toBeCloseTo(result.worldBefore.y, 6);
});

test('pans with a right-button drag', async ({ page }) => {
  await page.goto('/');
  const board = page.locator(canvas);
  const box = await board.boundingBox();
  const center = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };

  const before = await cameraOf(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x + 60, center.y + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const after = await cameraOf(page);

  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeGreaterThan(before.y);
});

test('leaves left-button drags for the track tool', async ({ page }) => {
  await page.goto('/');
  const board = page.locator(canvas);
  const box = await board.boundingBox();
  const center = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };

  const before = await cameraOf(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 120, center.y + 90, { steps: 5 });
  await page.mouse.up();
  const after = await cameraOf(page);

  expect(after.x).toBeCloseTo(before.x, 5);
  expect(after.y).toBeCloseTo(before.y, 5);
});

test('pans and pinches with two-finger touch emulation', async ({ page }) => {
  await page.goto('/');

  const dispatchGesture = (
    events: Array<{ type: string; id: number; x: number; y: number }>,
  ) =>
    page.evaluate((steps) => {
      const target = document.querySelector('#board-canvas') as HTMLCanvasElement;
      const rect = target.getBoundingClientRect();
      for (const step of steps) {
        target.dispatchEvent(
          new PointerEvent(step.type, {
            pointerId: step.id,
            pointerType: 'touch',
            isPrimary: step.id === 1,
            clientX: rect.left + step.x,
            clientY: rect.top + step.y,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }, events);

  const before = await cameraOf(page);
  await dispatchGesture([
    { type: 'pointerdown', id: 1, x: 200, y: 200 },
    { type: 'pointerdown', id: 2, x: 320, y: 200 },
    { type: 'pointermove', id: 1, x: 250, y: 230 },
    { type: 'pointermove', id: 2, x: 370, y: 230 },
    { type: 'pointerup', id: 1, x: 250, y: 230 },
    { type: 'pointerup', id: 2, x: 370, y: 230 },
  ]);
  const afterPan = await cameraOf(page);
  expect(afterPan.x).toBeGreaterThan(before.x);
  expect(afterPan.y).toBeGreaterThan(before.y);

  await dispatchGesture([
    { type: 'pointerdown', id: 1, x: 200, y: 200 },
    { type: 'pointerdown', id: 2, x: 300, y: 200 },
    { type: 'pointermove', id: 1, x: 150, y: 200 },
    { type: 'pointermove', id: 2, x: 350, y: 200 },
    { type: 'pointerup', id: 1, x: 150, y: 200 },
    { type: 'pointerup', id: 2, x: 350, y: 200 },
  ]);
  const afterPinch = await cameraOf(page);
  expect(afterPinch.scale).toBeGreaterThan(afterPan.scale);
});

test('turns cells into screen points and back with the debug handle', async ({ page }) => {
  await page.goto('/');
  const roundTrip = await page.evaluate(() => {
    const view = (
      window as unknown as {
        __ttb?: {
          view?: {
            screenToCell(point: { x: number; y: number }): { x: number; y: number };
            cellToScreen(cell: { x: number; y: number }): { x: number; y: number };
          };
        };
      }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');
    const cell = { x: 12, y: 9 };
    return view.screenToCell(view.cellToScreen(cell));
  });
  expect(roundTrip).toEqual({ x: 12, y: 9 });
});

test('runs without console errors while using the board', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  const board = page.locator(canvas);
  const box = await board.boundingBox();

  await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200);
  await page.mouse.wheel(0, -240);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move((box?.x ?? 0) + 260, (box?.y ?? 0) + 240, { steps: 3 });
  await page.mouse.up({ button: 'middle' });

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(errors).toEqual([]);
});
