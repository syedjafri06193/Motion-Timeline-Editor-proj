/**
 * Canvas preview (§7.2): the scene is drawn by our own evaluator, which is
 * why the evaluator is verified against the browser and lottie-web.
 */
import { colorToCss } from "../model/color.js";
import { layerState, setDriverScope } from "../model/evaluate.js";
import { worldMatrix } from "../model/transform.js";
import type { Animation, Color, Layer } from "../model/types.js";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const paths = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let p = paths.get(d);
  if (!p) { p = new Path2D(d); paths.set(d, p); }
  return p;
}

export function drawLayer(ctx: Ctx, anim: Animation, layer: Layer, time: number, tint?: Color): void {
  if (time < layer.inPoint || time >= layer.outPoint || layer.content.kind === "null") return;
  const s = layerState(layer, time);
  const m = worldMatrix(anim, layer, time);
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha *= Math.max(0, Math.min(1, s.opacity / 100)) * (tint ? 1 : s.fill[3]);
  ctx.fillStyle = colorToCss(tint ?? ([s.fill[0], s.fill[1], s.fill[2], 1] as Color));
  const c = layer.content;
  if (c.kind === "rect") {
    ctx.beginPath();
    if (c.radius && "roundRect" in ctx) (ctx as CanvasRenderingContext2D).roundRect(0, 0, c.width, c.height, c.radius);
    else ctx.rect(0, 0, c.width, c.height);
    ctx.fill();
  } else if (c.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fill(path2d(c.d));
  ctx.restore();
}

export function render(ctx: Ctx, anim: Animation, time: number, opts: { clear?: boolean; tint?: Color; scale?: number } = {}): void {
  const k = opts.scale ?? 1;
  setDriverScope(anim.layers);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (opts.clear !== false) {
    ctx.clearRect(0, 0, anim.width, anim.height);
    if (anim.background && !opts.tint) { ctx.fillStyle = colorToCss(anim.background); ctx.fillRect(0, 0, anim.width, anim.height); }
  }
  for (const l of anim.layers) drawLayer(ctx, anim, l, time, opts.tint);
  ctx.restore();
}
