import { expect, test } from '@playwright/test';

test('the app shell loads with a sized canvas and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#toolbar')).toBeVisible();

  const canvas = page.locator('#board-canvas');
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
