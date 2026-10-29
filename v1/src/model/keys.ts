/** Keyframe authoring helpers: add at playhead, toggle hold, copy/paste. */
import { layerValue } from "./evaluate.js";
import { getKey, mapLayer, type KeyRef } from "./edit.js";
import { channel, EASY_IN, EASY_OUT, type Animation, type Keyframe, type PropertyName, type Value } from "./types.js";

export function addKeyAt(anim: Animation, layerId: string, prop: PropertyName, time: number, value?: Value): Animation {
  return mapLayer(anim, layerId, (l) => {
    const v = value ?? layerValue(l, prop, time);
    const ch = l.channels[prop] ?? channel(prop, []);
    const kfs = ch.keyframes.filter((k) => Math.abs(k.time - time) > 1e-6);
    const existing = ch.keyframes.find((k) => Math.abs(k.time - time) <= 1e-6);
    kfs.push(existing ? { ...existing, value: v } : { time, value: v, easeOut: EASY_OUT, easeIn: EASY_IN });
    kfs.sort((a, b) => a.time - b.time);
    return { ...l, channels: { ...l.channels, [prop]: { ...ch, keyframes: kfs } } };
  });
}

export function toggleHold(anim: Animation, refs: KeyRef[]): Animation {
  let next = anim;
  const allHold = refs.every((r) => getKey(anim, r)?.hold);
  for (const r of refs) next = mapLayer(next, r.layerId, (l) => {
    const ch = l.channels[r.property]!;
    return { ...l, channels: { ...l.channels, [r.property]: { ...ch, keyframes: ch.keyframes.map((k, i) => (i === r.index ? { ...k, hold: !allHold } : k)) } } };
  });
  return next;
}

export interface Clip { items: Array<{ layerId: string; property: PropertyName; dt: number; key: Keyframe }> }

export function copyKeys(anim: Animation, refs: KeyRef[]): Clip {
  const keys = refs.map((r) => ({ r, k: getKey(anim, r)! })).filter((x) => x.k);
  const t0 = Math.min(...keys.map((x) => x.k.time));
  return { items: keys.map(({ r, k }) => ({ layerId: r.layerId, property: r.property, dt: k.time - t0, key: k })) };
}

export function pasteKeys(anim: Animation, clip: Clip, time: number): Animation {
  let next = anim;
  for (const it of clip.items) next = mapLayer(next, it.layerId, (l) => {
    const ch = l.channels[it.property] ?? channel(it.property, []);
    const t = Math.min(anim.duration, time + it.dt);
    const kfs = [...ch.keyframes.filter((k) => Math.abs(k.time - t) > 1e-6), { ...it.key, time: t }].sort((a, b) => a.time - b.time);
    return { ...l, channels: { ...l.channels, [it.property]: { ...ch, keyframes: kfs } } };
  });
  return next;
}

/** "Revolutions + degrees" (§6.2): 765° is 2x +45°. */
export function splitRevolutions(deg: number): { revolutions: number; degrees: number } {
  const revolutions = Math.trunc(deg / 360);
  return { revolutions, degrees: +(deg - revolutions * 360).toFixed(6) };
}
export const joinRevolutions = (revolutions: number, degrees: number) => revolutions * 360 + degrees;
