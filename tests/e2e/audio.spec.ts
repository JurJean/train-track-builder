import { expect, test } from '@playwright/test';

interface SfxHandle {
  play(name: string): void;
  clack(): void;
  tap(): void;
  thunk(): void;
  tick(): void;
  toot(): void;
  chuff(): void;
  isMuted(): boolean;
}

async function sfxNames(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const sfx = (
      window as unknown as { __ttb?: { sfx?: SfxHandle } }
    ).__ttb?.sfx;
    if (!sfx) throw new Error('window.__ttb.sfx is not registered');
    return ['clack', 'tap', 'thunk', 'tick', 'toot', 'chuff'].filter(
      (name) => typeof (sfx as unknown as Record<string, unknown>)[name] === 'function',
    );
  });
}

test('the dev QA handle can play every sound without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  // A real gesture first, matching how a player unlocks audio.
  await page.locator('#board-canvas').click();

  expect(await sfxNames(page)).toEqual(['clack', 'tap', 'thunk', 'tick', 'toot', 'chuff']);

  await page.evaluate(() => {
    const sfx = (
      window as unknown as { __ttb?: { sfx?: SfxHandle } }
    ).__ttb?.sfx;
    if (!sfx) throw new Error('window.__ttb.sfx is not registered');
    sfx.clack();
    sfx.tap();
    sfx.thunk();
    sfx.tick();
    sfx.toot();
    sfx.chuff();
    sfx.play('clack');
  });

  // Toggling mute must stay error-free too.
  await page.locator('#mute-btn').click();
  expect(await page.evaluate(() => {
    const sfx = (window as unknown as { __ttb?: { sfx?: SfxHandle } }).__ttb?.sfx;
    return sfx?.isMuted() ?? null;
  })).toBe(true);
  await page.evaluate(() => {
    const sfx = (window as unknown as { __ttb?: { sfx?: SfxHandle } }).__ttb?.sfx;
    sfx?.toot();
  });

  expect(errors).toEqual([]);
});
