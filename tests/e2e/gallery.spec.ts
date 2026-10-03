import { expect, test, type Page } from '@playwright/test';

const canvas = '#gallery-canvas';

interface GalleryState {
  scale: number;
  frames: number;
  pieces: number;
}

async function galleryState(page: Page): Promise<GalleryState> {
  return page.evaluate(() => {
    const handle = (
      window as unknown as {
        __ttb?: { gallery?: { scale: number; frames: number; pieces: number } };
      }
    ).__ttb?.gallery;
    if (!handle) throw new Error('window.__ttb.gallery is not registered');
    return { scale: handle.scale, frames: handle.frames, pieces: handle.pieces };
  });
}

test('the gallery loads with the art drawn and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/gallery.html');
  await expect(page.locator(canvas)).toBeVisible();

  // 8 kinds x 4 rotations, 3 kinds x 3 ghost states, and the two samples.
  const state = await galleryState(page);
  expect(state.pieces).toBe(8 * 4 + 3 * 3 + 11 + 7);
  expect(state.frames).toBeGreaterThan(0);

  const distinctColours = await page.evaluate(() => {
    const target = document.querySelector('#gallery-canvas') as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context) throw new Error('no 2d context');
    const data = context.getImageData(0, 0, target.width, target.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 17) {
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return colours.size;
  });
  expect(distinctColours).toBeGreaterThan(40);

  expect(errors).toEqual([]);
});

test('the zoom control redraws at several crisp scales', async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator(canvas)).toBeVisible();

  const before = await galleryState(page);
  await page.locator('#zoom').fill('48');
  await page.locator('#zoom').dispatchEvent('input');

  const after = await galleryState(page);
  expect(after.scale).toBe(48);
  expect(after.frames).toBeGreaterThan(before.frames);
  await expect(page.locator('#zoom-value')).toHaveText('48 px/cell');

  for (const value of [24, 72]) {
    await page.locator('#zoom').fill(String(value));
    await page.locator('#zoom').dispatchEvent('input');
    expect((await galleryState(page)).scale).toBe(value);
  }
});

test('marks an invalid ghost with red so validity is not colour-only', async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator(canvas)).toBeVisible();

  const region = await page.evaluate(() => {
    const handle = (
      window as unknown as {
        __ttb?: {
          gallery?: { worldToScreen(point: { x: number; y: number }): { x: number; y: number } };
        };
      }
    ).__ttb?.gallery;
    if (!handle) throw new Error('window.__ttb.gallery is not registered');
    const dpr = window.devicePixelRatio || 1;
    const topLeft = handle.worldToScreen({ x: 7, y: 27 });
    const bottomRight = handle.worldToScreen({ x: 8, y: 28 });
    return {
      x: topLeft.x * dpr,
      y: topLeft.y * dpr,
      w: (bottomRight.x - topLeft.x) * dpr,
      h: (bottomRight.y - topLeft.y) * dpr,
    };
  });

  const reddishPixels = await page.evaluate((box) => {
    const target = document.querySelector('#gallery-canvas') as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context) throw new Error('no 2d context');
    const data = context.getImageData(
      Math.max(0, Math.round(box.x)),
      Math.max(0, Math.round(box.y)),
      Math.max(1, Math.round(box.w)),
      Math.max(1, Math.round(box.h)),
    ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > g + 15 && r > b + 15) count += 1;
    }
    return count;
  }, region);

  expect(reddishPixels).toBeGreaterThan(20);
});

test.describe('device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sizes the gallery canvas crisply', async ({ page }) => {
    await page.goto('/gallery.html');
    const target = page.locator(canvas);
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    const size = await target.evaluate((element) => {
      const node = element as HTMLCanvasElement;
      return { width: node.width, height: node.height, dpr: window.devicePixelRatio };
    });
    expect(size.dpr).toBe(2);
    expect(size.width).toBe(Math.round((box?.width ?? 0) * 2));
    expect(size.height).toBe(Math.round((box?.height ?? 0) * 2));
  });
});
