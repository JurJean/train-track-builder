import './train-preview.css';
import { debugHandles } from './app/debug';
import type { Point, Pose } from './model/types';
import {
  CAR_LENGTH,
  createSteam,
  drawCarriage,
  drawEngine,
  drawSteam,
  prefersReducedMotion,
  updateSteam,
} from './render/train-art';

/**
 * Dev preview for the train art.
 *
 * An engine and two carriages drive round a circle using plain local circle
 * maths, so the cars can be judged in motion at every heading. A speed control
 * changes the pace, and the steam fades out under `prefers-reduced-motion`.
 * A second canvas lays out the engine and a carriage at eight headings, which
 * makes it easy to spot any stretched or mirrored art.
 */

/** Radius of the circular route, in cells. */
const CIRCLE_RADIUS = 2.6;
/** Arc length between the centres of adjacent cars. */
const CAR_SPACING = CAR_LENGTH * 1.4;
/** Number of carriages pulled behind the engine. */
const CARRIAGE_COUNT = 2;
/** Speed at the top of the slider, in cells per second. */
const MAX_SPEED = 2.4;
/** Extra world margin around the circle so noses are never clipped. */
const WORLD_EXTENT = CIRCLE_RADIUS + 0.9;

/** The static heading sampler. */
const HEADING_COUNT = 8;
const HEADING_PITCH = 1.5;

const PAPER = '#f6efe3';
const RAIL_DARK = '#8a7d6b';
const RAIL_LIGHT = '#e6e0d2';
const BALLAST = '#cbb083';
const SLEEPER = '#b99a63';

/** World pose of a point on the circle, facing along the tangent. */
function poseOnCircle(angle: number): Pose {
  return {
    x: Math.cos(angle) * CIRCLE_RADIUS,
    y: Math.sin(angle) * CIRCLE_RADIUS,
    heading: Math.atan2(Math.cos(angle), -Math.sin(angle)),
  };
}

function ring(ctx: CanvasRenderingContext2D, radius: number, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** A simple circular track so the moving train has something to run on. */
function drawTrackRing(ctx: CanvasRenderingContext2D): void {
  const gauge = 0.17;
  ring(ctx, CIRCLE_RADIUS, BALLAST, gauge * 2 + 0.22);

  const count = Math.max(8, Math.floor((2 * Math.PI * CIRCLE_RADIUS) / 0.26));
  ctx.strokeStyle = SLEEPER;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const inner = CIRCLE_RADIUS - gauge - 0.04;
    const outer = CIRCLE_RADIUS + gauge + 0.04;
    ctx.moveTo(cos * inner, sin * inner);
    ctx.lineTo(cos * outer, sin * outer);
  }
  ctx.stroke();

  ring(ctx, CIRCLE_RADIUS + gauge, RAIL_DARK, 0.075);
  ring(ctx, CIRCLE_RADIUS - gauge, RAIL_DARK, 0.075);
  ring(ctx, CIRCLE_RADIUS + gauge, RAIL_LIGHT, 0.034);
  ring(ctx, CIRCLE_RADIUS - gauge, RAIL_LIGHT, 0.034);
}

// --- the moving stage ------------------------------------------------------

const trainCanvas = document.querySelector<HTMLCanvasElement>('#train-canvas');
const trainCtx = trainCanvas?.getContext('2d') ?? null;
const speedInput = document.querySelector<HTMLInputElement>('#speed');
const speedValue = document.querySelector<HTMLOutputElement>('#speed-value');

let angle = -Math.PI / 2;
let speedFraction = Number(speedInput?.value ?? 45) / 100;
let speed = speedFraction * MAX_SPEED;
let frames = 0;
let lastTimestamp = 0;
let viewScale = 1;
let viewPan: Point = { x: 0, y: 0 };
const steam = createSteam();

function drawTrainFrame(): void {
  if (!trainCanvas || !trainCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, trainCanvas.clientWidth);
  const cssHeight = Math.max(1, trainCanvas.clientHeight);
  const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
  const backingHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (trainCanvas.width !== backingWidth) trainCanvas.width = backingWidth;
  if (trainCanvas.height !== backingHeight) trainCanvas.height = backingHeight;

  viewScale = Math.min(cssWidth, cssHeight) / (2 * WORLD_EXTENT);
  viewPan = { x: cssWidth / 2, y: cssHeight / 2 };

  trainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  trainCtx.clearRect(0, 0, cssWidth, cssHeight);
  trainCtx.fillStyle = PAPER;
  trainCtx.fillRect(0, 0, cssWidth, cssHeight);

  trainCtx.setTransform(
    dpr * viewScale,
    0,
    0,
    dpr * viewScale,
    dpr * viewPan.x,
    dpr * viewPan.y,
  );

  drawTrackRing(trainCtx);
  for (let i = CARRIAGE_COUNT; i >= 1; i -= 1) {
    const behind = angle - (i * CAR_SPACING) / CIRCLE_RADIUS;
    drawCarriage(trainCtx, poseOnCircle(behind), i - 1);
  }
  drawEngine(trainCtx, poseOnCircle(angle));
  drawSteam(trainCtx, steam);
}

function frame(now: number): void {
  const dt = lastTimestamp === 0 ? 0 : Math.min(0.05, (now - lastTimestamp) / 1000);
  lastTimestamp = now;

  angle += (speed / CIRCLE_RADIUS) * dt;
  updateSteam(steam, dt, poseOnCircle(angle), speed);
  drawTrainFrame();
  frames += 1;
  requestAnimationFrame(frame);
}

// --- the static heading sampler -------------------------------------------

const headingCanvas = document.querySelector<HTMLCanvasElement>('#heading-canvas');
const headingCtx = headingCanvas?.getContext('2d') ?? null;

function renderHeadings(): void {
  if (!headingCanvas || !headingCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, headingCanvas.clientWidth);
  const cssHeight = Math.round((cssWidth / (HEADING_COUNT * HEADING_PITCH)) * HEADING_PITCH * 2);
  headingCanvas.style.height = `${cssHeight}px`;

  const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
  const backingHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (headingCanvas.width !== backingWidth) headingCanvas.width = backingWidth;
  if (headingCanvas.height !== backingHeight) headingCanvas.height = backingHeight;

  const scale = cssWidth / (HEADING_COUNT * HEADING_PITCH);
  headingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  headingCtx.clearRect(0, 0, cssWidth, cssHeight);
  headingCtx.fillStyle = PAPER;
  headingCtx.fillRect(0, 0, cssWidth, cssHeight);

  headingCtx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  for (let i = 0; i < HEADING_COUNT; i += 1) {
    const at = { x: (i + 0.5) * HEADING_PITCH, y: 0.75 };
    drawEngine(headingCtx, { ...at, heading: (i * Math.PI) / 4 });
  }
  for (let i = 0; i < HEADING_COUNT; i += 1) {
    const at = { x: (i + 0.5) * HEADING_PITCH, y: 2.25 };
    drawCarriage(headingCtx, { ...at, heading: (i * Math.PI) / 4 }, i);
  }
}

// --- controls and wiring ---------------------------------------------------

function setSpeedFraction(fraction: number): void {
  speedFraction = Math.min(1, Math.max(0, fraction));
  speed = speedFraction * MAX_SPEED;
  if (speedInput) speedInput.value = String(Math.round(speedFraction * 100));
  if (speedValue) speedValue.textContent = `${speed.toFixed(1)} cells/s`;
}

speedInput?.addEventListener('input', () => {
  setSpeedFraction(Number(speedInput.value) / 100);
});

function onResize(): void {
  renderHeadings();
  drawTrainFrame();
}

window.addEventListener('resize', onResize);
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(onResize);
  if (trainCanvas) observer.observe(trainCanvas);
  if (headingCanvas) observer.observe(headingCanvas);
}

setSpeedFraction(speedFraction);
renderHeadings();
requestAnimationFrame((now) => {
  lastTimestamp = now;
  frame(now);
});

const handles = debugHandles();
if (handles) {
  handles.preview = {
    get angle() {
      return angle;
    },
    get speed() {
      return speed;
    },
    get frames() {
      return frames;
    },
    get puffs() {
      return steam.puffs.length;
    },
    get emitted() {
      return steam.emitted;
    },
    get reducedMotion() {
      return prefersReducedMotion();
    },
    setSpeed(fraction: number) {
      setSpeedFraction(fraction);
    },
    setAngle(value: number) {
      angle = value;
    },
    worldToScreen(point: Point): Point {
      return {
        x: point.x * viewScale + viewPan.x,
        y: point.y * viewScale + viewPan.y,
      };
    },
  };
}
