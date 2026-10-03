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

### Track art gallery

`gallery.html` is a dev page (served by the dev server, and part of the
production build) for reviewing the track art in `src/render/track-art.ts`. It
draws every kind at all four rotations, valid and invalid placement ghosts (the
invalid one is muted red with a diagonal hatch), and two connected samples — an
oval with a station and a figure-eight through a crossing — on the grass
background. A zoom control renders the same scene from 20 to 96 pixels per cell
so the art can be checked for crispness.

Open <http://localhost:5173/gallery.html> after `npm run dev`.

## Layout

```
index.html            app shell: palette, board (canvas), toolbar
gallery.html          dev page: every track piece, ghosts and sample layouts
src/
  main.ts             bootstraps the shell and sizes the canvas
  gallery.ts          draws the track art gallery
  style.css           full-viewport layout, soft warm colours
  gallery.css         gallery layout
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
- `src/render` draws to the canvas. `track-art.ts` owns `drawPiece`, the one
  place track pieces are painted; it caches a sprite per kind x rotation x zoom
  bucket.
- `src/ui` owns DOM elements and input handling.
- `src/audio` owns sound effects.
- `src/app` wires the pieces together and exposes debug handles in dev builds via
  `window.__ttb`.

## Board renderer

The board is a device-pixel-ratio aware canvas driven by `src/render/board.ts`,
with the pure camera maths in `src/render/camera.ts`. Layers register through
`board.addLayer(z, (ctx, view) => ...)`, where the context is already
transformed into world units (1 = one cell). The board only redraws when it is
dirty or a layer asks for animation frames, so an idle board uses no CPU.

In dev, `window.__ttb.view` exposes the live camera, `screenToCell`,
`cellToScreen` and the frame counter.

## Train art

`src/render/train-art.ts` draws the wooden toy engine, its carriages and its
steam in world units on a camera-transformed context. `drawEngine(ctx, pose)`
and `drawCarriage(ctx, pose, colorIndex)` take a pose whose `heading` is 0 east
and π/2 south; the art is rotated about the car's centre and never scaled, and
each car is symmetric across its long axis, so a car cannot stretch or mirror at
any heading. `createSteam` / `updateSteam` / `drawSteam` emit and fade soft puffs
(faster speed means more puffs) and switch off under
`prefers-reduced-motion: reduce`.

The dev page `train-preview.html` (`src/train-preview.ts`) drives an engine and
two carriages round a circle with a speed control, and lays out the engine and a
carriage at eight headings so the art can be judged for stretching and
mirroring. It is part of Vite's multi-page input. In dev,
`window.__ttb.preview` exposes the angle, speed, frame, puff and reduced-motion
state so tests and QA can drive it.

## Controls

The DOM controls around the board live in `src/ui` and only touch shared state:

- The palette (`#palette`) has eight piece buttons plus Rotate and Erase. Each
  button sets the current `tool` on the store; hovering or focusing a piece
  shows a larger preview. The selected tool is marked with `aria-pressed`.
- The toolbar (`#toolbar`) has Undo/Redo, a Go!/Stop button, a labelled speed
  slider and a mute toggle. Mute is saved to `localStorage` under `ttb:muted`
  and emits `mute-changed` on the event bus.
- Keyboard shortcuts: `R` rotate, `E` erase, `Esc` deselect,
  `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redo. The history shortcuts
  fire intents (`src/app/intents.ts`) rather than acting directly, so the editor
  and simulation can pick them up later. Shortcuts are ignored while typing.

The observable app store is `src/app/store.ts`, exposed as `window.__ttb.store`
in dev so tests can drive it with `store.set({ ... })`.

## Sound effects

Every sound is synthesised live with the Web Audio API (`src/audio/sfx.ts`) —
there are no audio files. The module subscribes to the event bus, so no other
module calls it directly, and the `AudioContext` is created (or resumed) lazily
on the first user gesture. If audio is unavailable or blocked, the sounds are
simply skipped. The mute flag is read from and written to `localStorage` under
`ttb:muted`.

| Event                  | Sound    | Recipe                                                                 |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| `piece-placed` (joined) | clack   | Two short triangle partials (~190 Hz, ~300 Hz) + a band-passed noise click; pitch/volume jitter ±6–10%. |
| `piece-placed` (alone)  | tap     | Same idea, quieter (one partial) and a little higher.                  |
| `piece-removed`         | thunk   | Sine sweeping 180 Hz → 70 Hz with a low-passed noise puff.             |
| `placement-rejected`    | tick    | Only a very quiet, short band-passed noise blip — never a buzzer.      |
| `train-started`         | toot    | Two whistle notes; each is a 1×/2×/3× sine stack with a fast attack, gentle release and a small pitch dip. A quiet chuff loop follows until `train-stopped`. |
| `train-stopped`         | —       | Stops the chuff loop.                                                  |
| `mute-changed`          | —       | Mutes/unmutes; also silences and stops the chuff loop.                 |

For QA, `window.__ttb.sfx` has `play(name)` plus `clack()`, `tap()`, `thunk()`,
`tick()`, `toot()` and `chuff()` helpers (dev builds only).

Under 700 px wide the palette moves to a horizontally scrollable bar above the
toolbar; every touch target is at least 44 px.

## Testing

- Unit tests live next to the code as `*.test.ts` (e.g.
  `src/model/pieces.test.ts`) and run under Vitest.
- End-to-end tests live in `tests/e2e` and run under Playwright against the dev
  server.

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, unit tests, build,
installs Playwright Chromium, and runs the e2e suite on pull requests and pushes
to `main`.
