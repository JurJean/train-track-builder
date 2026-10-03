import { expect, test, type Page } from '@playwright/test';

const trainCanvas = '#train-canvas';
const headingCanvas = '#heading-canvas';

interface PreviewState {
  angle: number;
  speed: number;
  frames: number;
  puffs: number;
  emitted: number;
  reducedMotion: boolean;
}

async function previewState(page: Page): Promise<PreviewState> {
  return page.evaluate(() => {
    const handle = (
      window as unknown as {
        __ttb?: {
          preview?: {
            angle: number;
            speed: number;
            frames: number;
            puffs: number;
            emitted: number;
            reducedMotion: boolean;
          };
        };
      }
    ).__ttb?.preview;
    if (!handle) throw new Error('window.__ttb.preview is not registered');
    return {
      angle: handle.angle,
      speed: handle.speed,
      frames: handle.frames,
      puffs: handle.puffs,
      emitted: handle.emitted,
      reducedMotion: handle.reducedMotion,
    };
  });
}

test('the preview loads, animates and puffs steam with no console errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/train-preview.html');
  await expect(page.locator(trainCanvas)).toBeVisible();
  await expect(page.locator(headingCanvas)).toBeVisible();

  const before = await previewState(page);
  await page.waitForTimeout(600);
  const after = await previewState(page);

  expect(after.frames).toBeGreaterThan(before.frames);
  expect(after.angle).not.toBe(before.angle);
  expect(after.emitted).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the speed control changes the pace', async ({ page }) => {
  await page.goto('/train-preview.html');
  await expect(page.locator(trainCanvas)).toBeVisible();

  await page.locator('#speed').fill('0');
  await page.locator('#speed').dispatchEvent('input');
  expect((await previewState(page)).speed).toBe(0);
  await expect(page.locator('#speed-value')).toHaveText('0.0 cells/s');

  await page.locator('#speed').fill('100');
  await page.locator('#speed').dispatchEvent('input');
  expect((await previewState(page)).speed).toBeCloseTo(2.4, 5);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('hides the steam', async ({ page }) => {
    await page.goto('/train-preview.html');
    await expect(page.locator(trainCanvas)).toBeVisible();
    await page.waitForTimeout(600);

    const state = await previewState(page);
    expect(state.reducedMotion).toBe(true);
    expect(state.puffs).toBe(0);
  });
});

test.describe('device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sizes both canvases crisply', async ({ page }) => {
    await page.goto('/train-preview.html');

    for (const selector of [trainCanvas, headingCanvas]) {
      const canvas = page.locator(selector);
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      const size = await canvas.evaluate((element) => {
        const node = element as HTMLCanvasElement;
        return { width: node.width, height: node.height, dpr: window.devicePixelRatio };
      });
      expect(size.dpr).toBe(2);
      expect(size.width).toBe(Math.round((box?.width ?? 0) * 2));
      expect(size.height).toBe(Math.round((box?.height ?? 0) * 2));
    }
  });
});
