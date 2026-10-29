/**
 * Motion-path overlay (§7.3): the anchor's world path as a polyline with a
 * dot per frame. Shows spacing — what animators read from onion skins — for
 * the cost of one polyline.
 */
import { apply, worldMatrix } from "../model/transform.js";
import { layerState } from "../model/evaluate.js";
import type { Animation, Layer } from "../model/types.js";

export function motionPathPoints(anim: Animation, layer: Layer): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = Math.round(anim.duration * anim.frameRate);
  for (let f = 0; f <= n; f++) {
    const t = f / anim.frameRate;
    const s = layerState(layer, t);
    pts.push(apply(worldMatrix(anim, layer, t), s.anchor[0], s.anchor[1]));
  }
  return pts;
}

export function drawMotionPath(ctx: CanvasRenderingContext2D, anim: Animation, layer: Layer, color = "#4c8dff"): void {
  const pts = motionPathPoints(anim, layer);
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
