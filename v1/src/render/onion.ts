/**
 * Onion skinning (§7): neighbouring times drawn with falloff, past and future
 * tinted. Skins are cached per (animation version, time) at half resolution,
 * so a scrub only re-renders the skins that moved; skins are skipped during
 * playback (§7.3).
 */
import type { Animation, Color } from "../model/types.js";
import { render } from "./scene.js";

export interface OnionConfig {
  before: number;
  after: number;
  mode: "frames" | "keyframes";
  /** Frames between skins in "frames" mode. */
  step: number;
  baseAlpha: number;
  pastTint: Color;
  futureTint: Color;
  resolution: number; // 0.5 = half
}

export const DEFAULT_ONION: OnionConfig = { before: 3, after: 3, mode: "frames", step: 2, baseAlpha: 0.5, pastTint: [0.9, 0.25, 0.25, 1], futureTint: [0.2, 0.7, 0.35, 1], resolution: 0.5 };

export function keyframeTimes(anim: Animation): number[] {
  const set = new Set<number>();
  for (const l of anim.layers) for (const ch of Object.values(l.channels)) for (const k of ch!.keyframes) set.add(k.time);
  return [...set].sort((a, b) => a - b);
}

/** Times of the skins around `time`, nearest first, each with its alpha. */
export function skinTimes(anim: Animation, time: number, cfg: OnionConfig): { past: Array<{ t: number; alpha: number }>; future: Array<{ t: number; alpha: number }> } {
  const past: Array<{ t: number; alpha: number }> = [], future: Array<{ t: number; alpha: number }> = [];
  if (cfg.mode === "frames") {
    const step = cfg.step / anim.frameRate;
    for (let i = 1; i <= cfg.before; i++) { const t = time - i * step; if (t >= 0) past.push({ t, alpha: cfg.baseAlpha * (1 - i / (cfg.before + 1)) }); }
    for (let i = 1; i <= cfg.after; i++) { const t = time + i * step; if (t <= anim.duration) future.push({ t, alpha: cfg.baseAlpha * (1 - i / (cfg.after + 1)) }); }
  } else {
    const kts = keyframeTimes(anim);
    const before = kts.filter((t) => t < time - 1e-9).reverse().slice(0, cfg.before);
    const after = kts.filter((t) => t > time + 1e-9).slice(0, cfg.after);
    before.forEach((t, i) => past.push({ t, alpha: cfg.baseAlpha * (1 - (i + 1) / (cfg.before + 1)) }));
    after.forEach((t, i) => future.push({ t, alpha: cfg.baseAlpha * (1 - (i + 1) / (cfg.after + 1)) }));
  }
  return { past, future };
}

type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D };

export class OnionRenderer {
  private cache = new Map<string, Surface>();
  private version = 0;
  private composite: Surface | null = null;
  renders = 0; // skin renders performed (for tests and the perf HUD)

  /** Call whenever the animation changes. */
  invalidate(): void { this.version++; this.cache.clear(); }

  private surface(anim: Animation, t: number, tint: Color, cfg: OnionConfig, make: (w: number, h: number) => Surface): Surface {
    const key = `${this.version}:${t.toFixed(6)}:${tint.join(",")}:${cfg.resolution}`;
    let s = this.cache.get(key);
    if (!s) {
      s = make(Math.ceil(anim.width * cfg.resolution), Math.ceil(anim.height * cfg.resolution));
      render(s.ctx as CanvasRenderingContext2D, anim, t, { tint, scale: cfg.resolution });
      this.renders++;
      this.cache.set(key, s);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    }
    return s;
  }

  draw(ctx: CanvasRenderingContext2D, anim: Animation, time: number, cfg: OnionConfig, playing: boolean, make: (w: number, h: number) => Surface = defaultSurface): void {
    if (playing) { render(ctx, anim, time, { clear: true }); return; }
    // Background only; the current frame is drawn once, on top of the skins.
    render(ctx, { ...anim, layers: [] }, time, { clear: true });
    const { past, future } = skinTimes(anim, time, cfg);
    // Composite the skins at their own (reduced) resolution, far to near, then
    // upscale once: one scaled blit instead of one per skin.
    const w = Math.ceil(anim.width * cfg.resolution), h = Math.ceil(anim.height * cfg.resolution);
    if (!this.composite || this.composite.canvas.width !== w || this.composite.canvas.height !== h) this.composite = make(w, h);
    const cx = this.composite.ctx;
    cx.globalAlpha = 1;
    cx.clearRect(0, 0, w, h);
    for (const s of [...past].reverse()) { cx.globalAlpha = s.alpha; cx.drawImage(this.surface(anim, s.t, cfg.pastTint, cfg, make).canvas as CanvasImageSource, 0, 0); }
    for (const s of [...future].reverse()) { cx.globalAlpha = s.alpha; cx.drawImage(this.surface(anim, s.t, cfg.futureTint, cfg, make).canvas as CanvasImageSource, 0, 0); }
    ctx.save();
    ctx.drawImage(this.composite.canvas as CanvasImageSource, 0, 0, anim.width, anim.height);
    ctx.restore();
    render(ctx, anim, time, { clear: false });
  }
}

function defaultSurface(w: number, h: number): Surface {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  return { canvas, ctx: canvas.getContext("2d") as OffscreenCanvasRenderingContext2D };
}
