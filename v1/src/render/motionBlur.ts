/**
 * Motion blur (stretch goal §17): average sub-frame renders across the
 * shutter (180° = half a frame), centred on the frame time.
 */
import type { Animation } from "../model/types.js";
import { render } from "./scene.js";

export function renderMotionBlur(ctx: CanvasRenderingContext2D, scratch: CanvasRenderingContext2D, anim: Animation, time: number, samples = 8, shutterDeg = 180): void {
  const span = (shutterDeg / 360) / anim.frameRate;
  ctx.clearRect(0, 0, anim.width, anim.height);
  for (let i = 0; i < samples; i++) {
    const t = Math.max(0, Math.min(anim.duration, time - span / 2 + (span * (i + 0.5)) / samples));
    render(scratch, anim, t);
    // Running average: sample i contributes 1/(i+1) of the result so far.
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(scratch.canvas as CanvasImageSource, 0, 0);
  }
  ctx.globalAlpha = 1;
}
