/**
 * Segment-level baking shared by both exporters: segments a target can't
 * express are replaced by linear sub-keyframes (bake.ts); all other segments
 * pass through untouched, so only the loss that exists is reported (§9.5).
 */
import { deltaE, lerpColorSrgb } from "../model/color.js";
import { evaluateChannel } from "../model/evaluate.js";
import type { Channel, Color, Keyframe, Value } from "../model/types.js";
import { LINEAR_IN, LINEAR_OUT } from "../model/types.js";
import { bake, euclid, type Metric } from "./bake.js";

export interface Expanded {
  keyframes: Keyframe[];
  bakedSegments: number;
  addedKeyframes: number;
  maxError: number;
}

const toVec = (v: Value): number[] => (typeof v === "number" ? [v] : v);
const fromVec = (v: number[], like: Value): Value => (typeof like === "number" ? v[0]! : v);

export const colorMetric: Metric = (a, b) => deltaE(a as Color, b as Color);

/** sRGB-lerp-aware colour metric: what a player draws between baked keys vs the OKLab truth. */
export function defaultTolerance(ch: Channel): { tol: number; metric: Metric } {
  if (ch.type === "color") return { tol: 1, metric: colorMetric };
  return { tol: ch.property === "opacity" ? 0.25 : 0.25, metric: euclid };
}

export function expandChannel(ch: Channel, needsBake: (a: Keyframe, b: Keyframe) => boolean, tol?: number): Expanded {
  const kfs = ch.keyframes.map((k) => ({ ...k })); // never mutate the caller's model
  const { tol: dt, metric } = defaultTolerance(ch);
  const tolerance = tol ?? dt;
  const out: Keyframe[] = [];
  let bakedSegments = 0, added = 0, maxError = 0;
  for (let i = 0; i < kfs.length; i++) {
    const a = kfs[i]!, b = kfs[i + 1];
    if (!b || a.hold || !needsBake(a, b)) {
      out.push(a);
      continue;
    }
    const f = (t: number) => toVec(evaluateChannel(ch, Math.min(b.time - 1e-12, Math.max(a.time, t))));
    const fEnd = (t: number) => (t >= b.time ? toVec(b.value) : f(t));
    const r = bake(fEnd, a.time, b.time, tolerance, ch.type === "color" ? (x, y) => colorMetric(x, y) : metric);
    // For colour the player lerps sRGB between baked keys; re-measure on that basis.
    if (ch.type === "color") {
      let m = 0;
      for (let k = 0; k < r.times.length - 1; k++)
        for (let s = 1; s < 8; s++) {
          const p = s / 8, t = r.times[k]! + (r.times[k + 1]! - r.times[k]!) * p;
          m = Math.max(m, deltaE(fEnd(t) as Color, lerpColorSrgb(r.values[k] as Color, r.values[k + 1] as Color, p)));
        }
      r.maxError = m;
    }
    bakedSegments++;
    maxError = Math.max(maxError, r.maxError);
    for (let k = 0; k < r.times.length - 1; k++) {
      if (k === 0) out.push({ ...a, easeOut: LINEAR_OUT, easeFn: undefined, spatialOut: undefined });
      else out.push({ time: r.times[k]!, value: fromVec(r.values[k]!, a.value), easeOut: LINEAR_OUT, easeIn: LINEAR_IN });
      if (k > 0) added++;
    }
    // The next keyframe keeps its own outgoing easing but arrives linearly.
    kfs[i + 1] = { ...b, easeIn: LINEAR_IN, spatialIn: undefined };
  }
  return { keyframes: out, bakedSegments, addedKeyframes: added, maxError };
}

