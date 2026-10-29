/**
 * Drivers (stretch goal §17) exported by baking: neither Lottie (without
 * expressions, which are outside the subset) nor CSS can link properties, so
 * a driven property becomes ordinary keyframes sampled to tolerance.
 */
import { bake } from "../export/bake.js";
import { layerValue, setDriverScope } from "./evaluate.js";
import { LINEAR_IN, LINEAR_OUT, PROPERTY_TYPES, type Animation, type PropertyName } from "./types.js";

export interface BakedDriver { layer: string; property: PropertyName; keyframes: number; maxError: number }

export function bakeDrivers(anim: Animation, tolerance = 0.1): { anim: Animation; baked: BakedDriver[] } {
  const baked: BakedDriver[] = [];
  if (!anim.layers.some((l) => l.drivers?.length)) return { anim, baked };
  setDriverScope(anim.layers);
  const layers = anim.layers.map((l) => {
    if (!l.drivers?.length) return l;
    const channels = { ...l.channels };
    for (const prop of new Set(l.drivers.map((d) => d.property))) {
      const f = (t: number) => { const v = layerValue(l, prop, t); return typeof v === "number" ? [v] : v; };
      const r = bake(f, 0, anim.duration, tolerance);
      const scalar = typeof layerValue(l, prop, 0) === "number";
      channels[prop] = { property: prop, type: PROPERTY_TYPES[prop], spatial: false, keyframes: r.times.map((t, i) => ({ time: t, value: scalar ? r.values[i]![0]! : r.values[i]!, easeOut: LINEAR_OUT, easeIn: LINEAR_IN })) };
      baked.push({ layer: l.name, property: prop, keyframes: r.times.length, maxError: r.maxError });
    }
    const { drivers, ...rest } = l;
    void drivers;
    return { ...rest, channels };
  });
  return { anim: { ...anim, layers }, baked };
}
