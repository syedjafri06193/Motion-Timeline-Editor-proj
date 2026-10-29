/**
 * Channel evaluation (§15.2) and per-type interpolation (§6).
 * - binary search for the segment
 * - hold keyframes snap
 * - per-dimension easing when the handle arrays have N entries
 * - rotation accumulates (never shortest path, §6.2)
 * - colour interpolates in OKLab (§6.3)
 * - curved position segments follow the spatial bezier by arc length (§8.4)
 */
import { cachedEase } from "../easing/cache.js";
import { EASING_FUNCTIONS } from "../easing/presets.js";
import { lerpColorOklab, lerpColorSrgb } from "./color.js";
import { isCurved, pointAtDistance, type Vec2 } from "./spatial.js";
import { STATIC_DEFAULTS, type Channel, type Color, type Keyframe, type Layer, type PropertyName, type Value } from "./types.js";

export function segmentIndex(kfs: Keyframe[], time: number): number {
  let lo = 0, hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Eased progress for dimension d of the segment a→b at raw progress x. */
export function segmentEase(a: Keyframe, b: Keyframe, x: number, d = 0): number {
  if (a.easeFn) return EASING_FUNCTIONS[a.easeFn](x);
  const o = a.easeOut, i = b.easeIn;
  const k = (arr: number[]) => arr[Math.min(d, arr.length - 1)]!;
  return cachedEase(x, k(o.x), k(o.y), k(i.x), k(i.y));
}

export function isPerDimension(a: Keyframe, b: Keyframe): boolean {
  return !a.easeFn && (a.easeOut.x.length > 1 || b.easeIn.x.length > 1);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function evaluateChannel(ch: Channel, time: number): Value {
  const kfs = ch.keyframes;
  if (kfs.length === 0) throw new Error(`empty channel ${ch.property}`);
  const first = kfs[0]!, last = kfs[kfs.length - 1]!;
  if (kfs.length === 1 || time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  const i = segmentIndex(kfs, time);
  const a = kfs[i]!, b = kfs[i + 1]!;
  if (a.hold) return a.value;
  const x = (time - a.time) / (b.time - a.time);

  if (ch.type === "color") return (ch.colorSpace === "srgb" ? lerpColorSrgb : lerpColorOklab)(a.value as Color, b.value as Color, segmentEase(a, b, x));
  if (ch.type === "number" || ch.type === "angle") return lerp(a.value as number, b.value as number, segmentEase(a, b, x));

  const av = a.value as number[], bv = b.value as number[];
  if (ch.spatial && isCurved(a.spatialOut, b.spatialIn)) {
    // Spatial segments use one easing along the path (dimension 0), as Lottie does.
    const p0 = av as Vec2, p3 = bv as Vec2;
    const c1: Vec2 = [p0[0] + (a.spatialOut?.[0] ?? 0), p0[1] + (a.spatialOut?.[1] ?? 0)];
    const c2: Vec2 = [p3[0] + (b.spatialIn?.[0] ?? 0), p3[1] + (b.spatialIn?.[1] ?? 0)];
    return pointAtDistance(p0, c1, c2, p3, segmentEase(a, b, x), a);
  }
  if (isPerDimension(a, b)) return av.map((v, d) => lerp(v, bv[d]!, segmentEase(a, b, x, d)));
  const t = segmentEase(a, b, x);
  return av.map((v, d) => lerp(v, bv[d]!, t));
}

/** Layers visible to drivers; set by the caller that owns the animation (render, exporters). */
let driverScope: Layer[] = [];
export function setDriverScope(layers: Layer[]): void { driverScope = layers; }

export function layerValue(layer: Layer, prop: PropertyName, time: number, depth = 0): Value {
  const ch = layer.channels[prop];
  let v: Value = ch && ch.keyframes.length ? evaluateChannel(ch, time) : STATIC_DEFAULTS[prop];
  const drivers = layer.drivers?.filter((d) => d.property === prop);
  if (drivers?.length && depth < 8) {
    for (const d of drivers) {
      const src = driverScope.find((l) => l.id === d.source.layerId);
      if (!src) continue;
      const sv = layerValue(src, d.source.property, time - (d.delay ?? 0), depth + 1);
      const s = typeof sv === "number" ? sv : sv[d.source.dim ?? 0]!;
      const out = s * d.multiply + d.add;
      if (typeof v === "number") v = out;
      else { v = [...v]; if (d.dim === undefined) v = v.map(() => out); else v[d.dim] = out; }
    }
  }
  return v;
}

export interface LayerState {
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
  fill: Color;
}

export function layerState(layer: Layer, time: number): LayerState {
  return {
    anchor: layerValue(layer, "anchor", time) as Vec2,
    position: layerValue(layer, "position", time) as Vec2,
    scale: layerValue(layer, "scale", time) as Vec2,
    rotation: layerValue(layer, "rotation", time) as number,
    opacity: layerValue(layer, "opacity", time) as number,
    fill: layerValue(layer, "fill", time) as Color,
  };
}

export function animatedProperties(layer: Layer): PropertyName[] {
  return (Object.keys(layer.channels) as PropertyName[]).filter((p) => (layer.channels[p]?.keyframes.length ?? 0) > 1);
}
