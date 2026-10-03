import { expect, test, type Page } from '@playwright/test';

interface StoreState {
  tool: { type: string; kind?: string; rotation?: number };
  mode: string;
  canGo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  speed: number;
  muted: boolean;
}

async function storeState(page: Page): Promise<StoreState> {
  return page.evaluate(() => {
    const store = (
      window as unknown as { __ttb?: { store?: { get(): StoreState } } }
    ).__ttb?.store;
    if (!store) throw new Error('window.__ttb.store is not registered');
    return store.get();
  });
}

async function setStore(page: Page, partial: Record<string, unknown>): Promise<void> {
  await page.evaluate((patch) => {
    const store = (
      window as unknown as { __ttb?: { store?: { set(p: unknown): void } } }
    ).__ttb?.store;
    if (!store) throw new Error('window.__ttb.store is not registered');
    store.set(patch);
  }, partial);
}

test.describe('palette', () => {
  test('selects pieces by click and by keyboard', async ({ page }) => {
    await page.goto('/');

    const straight = page.getByRole('button', { name: 'Straight', exact: true });
    const crossing = page.getByRole('button', { name: 'Crossing', exact: true });

    await straight.click();
    await expect(straight).toHaveAttribute('aria-pressed', 'true');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'straight',
      rotation: 0,
    });

    await crossing.click();
    await expect(crossing).toHaveAttribute('aria-pressed', 'true');
    await expect(straight).toHaveAttribute('aria-pressed', 'false');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'crossing',
      rotation: 0,
    });

    // Keyboard selection: focus a piece and confirm it with Enter.
    const gentle = page.getByRole('button', { name: 'Gentle curve', exact: true });
    await gentle.focus();
    await page.keyboard.press('Enter');
    await expect(gentle).toHaveAttribute('aria-pressed', 'true');
    await expect(crossing).toHaveAttribute('aria-pressed', 'false');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'curve-gentle',
      rotation: 0,
    });
  });

  test('shows a larger preview with the name on hover and focus', async ({ page }) => {
    await page.goto('/');
    const preview = page.locator('#piece-preview');

    await expect(preview).toContainText('No tool selected');

    await page.getByRole('button', { name: 'Station', exact: true }).hover();
    await expect(preview).toContainText('Station');

    await page.getByRole('button', { name: 'Tunnel', exact: true }).focus();
    await expect(preview).toContainText('Tunnel');
  });
});

test.describe('keyboard shortcuts', () => {
  test('R rotates, E erases and Esc clears', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();

    await page.keyboard.press('r');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'straight',
      rotation: 1,
    });

    await page.keyboard.press('r');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'straight',
      rotation: 2,
    });

    await page.keyboard.press('e');
    expect((await storeState(page)).tool).toEqual({ type: 'erase' });
    await expect(page.locator('#erase-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rotate-btn')).toBeDisabled();

    await page.keyboard.press('Escape');
    expect((await storeState(page)).tool).toEqual({ type: 'none' });
    await expect(page.locator('#erase-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('ignores shortcuts while typing in an input', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();

    // The speed slider is a real input; shortcuts should not fire from it.
    await page.locator('#speed').focus();
    await page.keyboard.press('e');
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'straight',
      rotation: 0,
    });
  });
});

test.describe('toolbar', () => {
  test('Go! enables and disables when the store changes', async ({ page }) => {
    await page.goto('/');
    const go = page.locator('#go-btn');
    const hint = page.locator('#go-hint');

    await expect(go).toBeDisabled();
    await expect(go).toHaveText('Go!');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Close the loop to go');

    await setStore(page, { canGo: true });
    await expect(go).toBeEnabled();
    await expect(hint).toBeHidden();
    await expect(go).toHaveClass(/go-ready/);

    await setStore(page, { canGo: false });
    await expect(go).toBeDisabled();
    await expect(hint).toBeVisible();
  });

  test('Go! turns into Stop while running', async ({ page }) => {
    await page.goto('/');
    await setStore(page, { canGo: true });

    const go = page.locator('#go-btn');
    await go.click();
    await expect(go).toHaveText('Stop');
    await expect(go).toBeEnabled();
    expect((await storeState(page)).mode).toBe('running');

    await go.click();
    await expect(go).toHaveText('Go!');
    expect((await storeState(page)).mode).toBe('build');
  });

  test('the speed slider updates the store and shows its value', async ({ page }) => {
    await page.goto('/');
    const speed = page.getByRole('slider', { name: 'Speed' });
    await speed.fill('0.75');
    expect((await storeState(page)).speed).toBe(0.75);
    await expect(page.locator('#speed-value')).toHaveText('75%');
  });

  test('mute survives a reload', async ({ page }) => {
    await page.goto('/');
    const mute = page.locator('#mute-btn');

    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect(mute).toHaveText('Sound on');

    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(mute).toHaveText('Sound off');
    expect(await page.evaluate(() => localStorage.getItem('ttb:muted'))).toBe('true');

    await page.reload();
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mute-btn')).toHaveText('Sound off');
  });
});

test.describe('responsive layout', () => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    test(`fits at ${viewport.width}×${viewport.height} without overflow`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      await expect(page.locator('#palette')).toBeVisible();
      await expect(page.locator('#board')).toBeVisible();
      await expect(page.locator('#toolbar')).toBeVisible();
      await expect(page.locator('#go-btn')).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);

      // Every touch target around the board is at least 44px in both axes.
      const targets = await page
        .locator('#palette .piece, #palette .palette-action, #toolbar button, #speed')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }),
        );
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }

      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}.png`) });
    });
  }
});
