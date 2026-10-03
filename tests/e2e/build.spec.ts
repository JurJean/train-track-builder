import { expect, test, type Page } from '@playwright/test';

interface Cell {
  x: number;
  y: number;
}

interface PlacedPiece {
  id: string;
  kind: string;
  origin: Cell;
  rotation: number;
}

interface StoreState {
  tool: { type: string; kind?: string; rotation?: number };
  canUndo: boolean;
  canRedo: boolean;
}

const CANVAS = '#board-canvas';

async function layout(page: Page): Promise<{ pieces: PlacedPiece[] }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { __ttb?: { editor?: { layout(): unknown } } })
      .__ttb?.editor;
    if (!editor) throw new Error('window.__ttb.editor is not registered');
    return editor.layout() as { pieces: PlacedPiece[] };
  });
}

async function storeState(page: Page): Promise<StoreState> {
  return page.evaluate(() => {
    const store = (window as unknown as { __ttb?: { store?: { get(): unknown } } }).__ttb
      ?.store;
    if (!store) throw new Error('window.__ttb.store is not registered');
    return store.get() as StoreState;
  });
}

/** Page coordinates of a cell's centre, using the debug view handle. */
async function cellToPage(page: Page, cell: Cell): Promise<{ x: number; y: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  const local = await page.evaluate((value) => {
    const view = (
      window as unknown as {
        __ttb?: { view?: { cellToScreen(c: Cell): { x: number; y: number } } };
      }
    ).__ttb?.view;
    if (!view) throw new Error('window.__ttb.view is not registered');
    return view.cellToScreen(value);
  }, cell);
  return { x: (box?.x ?? 0) + local.x, y: (box?.y ?? 0) + local.y };
}

async function placeKind(page: Page, name: string, cell: Cell): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
  const point = await cellToPage(page, cell);
  await page.mouse.click(point.x, point.y);
}

const ALL_KINDS: Array<{ kind: string; name: string; cell: Cell }> = [
  { kind: 'straight', name: 'Straight', cell: { x: 2, y: 2 } },
  { kind: 'curve-sharp', name: 'Sharp curve', cell: { x: 4, y: 2 } },
  { kind: 'curve-gentle', name: 'Gentle curve', cell: { x: 6, y: 2 } },
  { kind: 'crossing', name: 'Crossing', cell: { x: 9, y: 2 } },
  { kind: 'bridge', name: 'Bridge', cell: { x: 11, y: 2 } },
  { kind: 'tunnel', name: 'Tunnel', cell: { x: 13, y: 2 } },
  { kind: 'station', name: 'Station', cell: { x: 15, y: 2 } },
  { kind: 'buffer-stop', name: 'Buffer stop', cell: { x: 17, y: 2 } },
];

test.describe('building', () => {
  test('places each of the eight kinds and keeps the tool selected', async ({ page }) => {
    await page.goto('/');

    for (const { name, cell } of ALL_KINDS) {
      await placeKind(page, name, cell);
    }

    const pieces = (await layout(page)).pieces;
    expect(pieces.map((piece) => piece.kind)).toEqual(ALL_KINDS.map((k) => k.kind));
    expect(pieces.map((piece) => piece.origin)).toEqual(ALL_KINDS.map((k) => k.cell));

    // The last piece stays armed so the player can keep building.
    const state = await storeState(page);
    expect(state.tool).toEqual({ type: 'place', kind: 'buffer-stop', rotation: 0 });
  });

  test('rotates the ghost with R and the Rotate button', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();

    await page.keyboard.press('r');
    expect((await storeState(page)).tool).toMatchObject({ rotation: 1 });

    await page.locator('#rotate-btn').click();
    expect((await storeState(page)).tool).toMatchObject({ rotation: 2 });

    const point = await cellToPage(page, { x: 5, y: 5 });
    await page.mouse.click(point.x, point.y);

    const pieces = (await layout(page)).pieces;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ kind: 'straight', rotation: 2 });
  });

  test('rejects an overlapping placement and only emits placement-rejected', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto('/');
    await page.evaluate(() => {
      const state = window as unknown as {
        __rejections?: string[];
        __ttb?: { bus?: { on(name: string, handler: (p: { reason: string }) => void): void } };
      };
      state.__rejections = [];
      state.__ttb?.bus?.on('placement-rejected', (payload) => {
        state.__rejections?.push(payload.reason);
      });
    });

    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    const point = await cellToPage(page, { x: 5, y: 5 });
    await page.mouse.click(point.x, point.y);

    const before = await layout(page);
    await page.mouse.click(point.x, point.y);
    const after = await layout(page);

    expect(after.pieces).toEqual(before.pieces);
    const rejections = await page.evaluate(
      () => (window as unknown as { __rejections?: string[] }).__rejections,
    );
    expect(rejections).toEqual(['overlap']);
    expect(dialogs).toEqual([]);
  });

  test('erases the piece under the pointer', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const editor = (window as unknown as { __ttb?: { editor?: { place(...args: unknown[]): void } } })
        .__ttb?.editor;
      editor?.place('station', { x: 5, y: 5 }, 0);
    });
    expect((await layout(page)).pieces).toHaveLength(1);

    await page.locator('#erase-btn').click();
    const point = await cellToPage(page, { x: 5, y: 6 }); // the station's lower half
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(50);
    await page.mouse.click(point.x, point.y);

    expect((await layout(page)).pieces).toHaveLength(0);
  });

  test('undoes and redoes 20 steps back and forth', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();

    for (let i = 0; i < 20; i += 1) {
      const point = await cellToPage(page, { x: 1 + i, y: 10 });
      await page.mouse.click(point.x, point.y);
    }
    const full = await layout(page);
    expect(full.pieces).toHaveLength(20);

    for (let i = 0; i < 20; i += 1) await page.locator('#undo-btn').click();
    expect((await layout(page)).pieces).toHaveLength(0);
    let state = await storeState(page);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);

    for (let i = 0; i < 20; i += 1) await page.locator('#redo-btn').click();
    expect(await layout(page)).toEqual(full);
    state = await storeState(page);
    expect(state.canRedo).toBe(false);
  });
});

test.describe('touch', () => {
  test('drags a piece from the palette onto the board', async ({ page }) => {
    await page.goto('/');
    const target = await cellToPage(page, { x: 8, y: 8 });

    const during = await page.evaluate(
      ({ target }) => {
        const button = document.querySelector('.piece[data-kind="crossing"]') as HTMLElement;
        const rect = button.getBoundingClientRect();
        const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const send = (type: string, x: number, y: number): void => {
          button.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              buttons: 1,
              bubbles: true,
              cancelable: true,
            }),
          );
        };

        send('pointerdown', start.x, start.y);
        send('pointermove', target.x, target.y);
        const build = (
          window as unknown as { __ttb?: { build?: { pointerCell(): { x: number; y: number } | null } } }
        ).__ttb?.build;
        const ghost = build?.pointerCell() ?? null;
        send('pointerup', target.x, target.y);
        return ghost;
      },
      { target },
    );

    expect(during).toEqual({ x: 8, y: 8 });

    const pieces = (await layout(page)).pieces;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      kind: 'crossing',
      origin: { x: 8, y: 8 },
      rotation: 0,
    });
    expect((await storeState(page)).tool).toEqual({
      type: 'place',
      kind: 'crossing',
      rotation: 0,
    });
  });

  test('a small touch movement still counts as a tap', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    const point = await cellToPage(page, { x: 12, y: 12 });

    await page.evaluate(
      ({ point }) => {
        const canvas = document.querySelector('#board-canvas') as HTMLCanvasElement;
        const send = (type: string, x: number, y: number): void => {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 3,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              buttons: 1,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        send('pointerdown', point.x, point.y);
        send('pointermove', point.x + 3, point.y + 3);
        send('pointerup', point.x + 3, point.y + 3);
      },
      { point },
    );

    const pieces = (await layout(page)).pieces;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ kind: 'straight', origin: { x: 12, y: 12 } });
  });

  test('a two-finger camera gesture does not place a piece', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    const center = await cellToPage(page, { x: 16, y: 12 });

    await page.evaluate(
      ({ center }) => {
        const canvas = document.querySelector('#board-canvas') as HTMLCanvasElement;
        const send = (
          type: string,
          id: number,
          x: number,
          y: number,
        ): void => {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: id,
              pointerType: 'touch',
              isPrimary: id === 1,
              clientX: x,
              clientY: y,
              buttons: 1,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        send('pointerdown', 1, center.x - 40, center.y);
        send('pointerdown', 2, center.x + 40, center.y);
        send('pointermove', 1, center.x - 70, center.y + 20);
        send('pointermove', 2, center.x + 70, center.y + 20);
        send('pointerup', 1, center.x - 70, center.y + 20);
        send('pointerup', 2, center.x + 70, center.y + 20);
      },
      { center },
    );

    expect((await layout(page)).pieces).toHaveLength(0);
  });
});

test.describe('camera', () => {
  test('space + left drag pans without placing a piece', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __ttb?: { store?: { set(patch: unknown): void } };
        }
      ).__ttb?.store;
      store?.set({ tool: { type: 'place', kind: 'straight', rotation: 0 } });
    });

    const point = await cellToPage(page, { x: 8, y: 8 });
    const cameraOf = () =>
      page.evaluate(() => {
        const view = (
          window as unknown as { __ttb?: { view?: { camera: { x: number; y: number } } } }
        ).__ttb?.view;
        return { ...(view?.camera as { x: number; y: number }) };
      });

    const before = await cameraOf();
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(point.x + 80, point.y + 40, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const after = await cameraOf();

    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect((await layout(page)).pieces).toHaveLength(0);
  });
});

test.describe('rendering', () => {
  test('interactive building and erasing produces no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    const point = await cellToPage(page, { x: 3, y: 3 });
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);

    await page.locator('#erase-btn').click();
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);

    await page.locator('#undo-btn').click();
    await page.locator('#redo-btn').click();

    expect(errors).toEqual([]);
  });

  test('stops redrawing while the pointer is still', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    const point = await cellToPage(page, { x: 10, y: 10 });
    await page.mouse.move(point.x, point.y);

    await page.waitForTimeout(200);
    const before = await page.evaluate(
      () => (window as unknown as { __ttb?: { view?: { frames: number } } }).__ttb?.view?.frames,
    );
    await page.waitForTimeout(400);
    const after = await page.evaluate(
      () => (window as unknown as { __ttb?: { view?: { frames: number } } }).__ttb?.view?.frames,
    );

    expect(after).toBe(before);
  });

  test('neighbouring rails meet and the scene renders without console errors', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __ttb?: { editor?: { place(kind: string, origin: Cell, rotation: number): unknown } };
        }
      ).__ttb?.editor;
      if (!editor) throw new Error('window.__ttb.editor is not registered');

      // The same connected oval used by the gallery, shifted near the centre.
      const ox = 14;
      const oy = 10;
      const oval: Array<[string, number, number, number]> = [
        ['curve-sharp', 0, 0, 0],
        ['straight', 1, 0, 1],
        ['straight', 2, 0, 1],
        ['curve-sharp', 3, 0, 1],
        ['straight', 3, 1, 0],
        ['straight', 3, 2, 0],
        ['curve-sharp', 3, 3, 2],
        ['straight', 2, 3, 1],
        ['straight', 1, 3, 1],
        ['curve-sharp', 0, 3, 3],
        ['station', 0, 1, 0],
      ];
      for (const [kind, x, y, rotation] of oval) {
        const placed = editor.place(kind, { x: ox + x, y: oy + y }, rotation);
        if (!placed) throw new Error(`failed to place ${kind} at ${x},${y}`);
      }
    });

    // Zoom right in on the oval so the rail joins can be checked by eye.
    const centre = await cellToPage(page, { x: 16, y: 12 });
    await page.mouse.move(centre.x, centre.y);
    for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, -600);
    await page.waitForTimeout(200);

    const box = await page.locator(CANVAS).boundingBox();
    expect(box).not.toBeNull();
    const topLeft = await cellToPage(page, { x: 14, y: 10 });
    const bottomRight = await cellToPage(page, { x: 18, y: 14 });
    const pad = 90;
    const clipX = Math.max(box?.x ?? 0, Math.min(topLeft.x, bottomRight.x) - pad);
    const clipY = Math.max(box?.y ?? 0, Math.min(topLeft.y, bottomRight.y) - pad);
    const clip = {
      x: clipX,
      y: clipY,
      width: Math.min((box?.x ?? 0) + (box?.width ?? 0), Math.max(topLeft.x, bottomRight.x) + pad) - clipX,
      height:
        Math.min((box?.y ?? 0) + (box?.height ?? 0), Math.max(topLeft.y, bottomRight.y) + pad) - clipY,
    };

    const path = 'docs/screenshots/issue-11/oval-join.png';
    await page.screenshot({ path, clip });
    await testInfo.attach('oval-join', { path, contentType: 'image/png' });

    expect(errors).toEqual([]);
  });
});
