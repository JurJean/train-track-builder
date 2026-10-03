# Train Track Builder

A browser toy where you lay train tracks piece by piece, then hit play and watch
your train chug around the whole route you built.

Built with Vite + TypeScript (strict), plain DOM, and Canvas 2D. There are no
runtime dependencies.

## Getting started

```bash
npm install
npm run dev
```

The dev server prints a local URL (default <http://localhost:5173>). To pin the
port, pass it through to Vite:

```bash
npm run dev -- --port 5555 --strictPort
```

## Scripts

| Script            | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server.                                          |
| `npm run build`   | Typecheck (`tsc --noEmit`) then produce a production build.         |
| `npm run preview` | Serve the production build locally.                                 |
| `npm run typecheck` | Run `tsc --noEmit` only.                                          |
| `npm run test`    | Run Vitest unit tests once.                                         |
| `npm run test:e2e` | Run Playwright end-to-end tests (Chromium).                        |

Playwright starts its own dev server on port 4173 (`--strictPort`), so nothing
needs to be running first.

## Layout

```
index.html            app shell: palette, board (canvas), toolbar
src/
  main.ts             bootstraps the shell and sizes the canvas
  style.css           full-viewport layout, soft warm colours
  model/              pure logic and shared contracts (no DOM)
  sim/                train simulation (no DOM)
  render/             canvas drawing
  ui/                 DOM UI
  audio/              sound effects
  app/                wiring between the above
tests/e2e/            Playwright tests
```

## Folder rules

- `src/model` is pure logic and must not touch the DOM. It owns the shared types
  (`types.ts`), the track piece catalogue (`pieces.ts`), and later layout/route
  logic.
- `src/sim` is the train simulation; also DOM-free, so it can be unit tested.
- `src/render` draws to the canvas.
- `src/ui` owns DOM elements and input handling.
- `src/audio` owns sound effects.
- `src/app` wires the pieces together and exposes debug handles in dev builds via
  `window.__ttb`.

## Testing

- Unit tests live next to the code as `*.test.ts` (e.g.
  `src/model/pieces.test.ts`) and run under Vitest.
- End-to-end tests live in `tests/e2e` and run under Playwright against the dev
  server.

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, unit tests, build,
installs Playwright Chromium, and runs the e2e suite on pull requests and pushes
to `main`.
