/** Immutable edit operations on the model, used by the timeline, curve editor and history. */
import type { Animation, BezierHandle, Keyframe, Layer, PropertyName } from "./types.js";

export interface KeyRef { layerId: string; property: PropertyName; index: number }

export const keyId = (r: KeyRef) => `${r.layerId}/${r.property}/${r.index}`;

export function getKey(anim: Animation, r: KeyRef): Keyframe | undefined {
  return anim.layers.find((l) => l.id === r.layerId)?.channels[r.property]?.keyframes[r.index];
}

export function mapLayer(anim: Animation, id: string, fn: (l: Layer) => Layer): Animation {
  return { ...anim, layers: anim.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

/** Apply fn to each referenced keyframe, then re-sort channels by time. Returns the new refs in the same order. */
export function mapKeys(anim: Animation, refs: KeyRef[], fn: (k: Keyframe, r: KeyRef) => Keyframe): { anim: Animation; refs: KeyRef[] } {
  const marked = new Map<string, symbol>();
  let next = anim;
  for (const r of refs) {
    const tag = Symbol(keyId(r));
    marked.set(keyId(r), tag);
    next = mapLayer(next, r.layerId, (l) => {
      const ch = l.channels[r.property];
      if (!ch) return l;
      const kfs = ch.keyframes.map((k, i) => (i === r.index ? Object.assign(fn(k, r), { __tag: tag }) : k));
      return { ...l, channels: { ...l.channels, [r.property]: { ...ch, keyframes: kfs } } };
    });
  }
  // Sort and recover indices.
  const out: KeyRef[] = [];
  next = {
    ...next,
    layers: next.layers.map((l) => ({
      ...l,
      channels: Object.fromEntries(Object.entries(l.channels).map(([p, ch]) => [p, { ...ch!, keyframes: [...ch!.keyframes].sort((a, b) => a.time - b.time) }])),
    })),
  };
  for (const r of refs) {
    const tag = marked.get(keyId(r));
    const ch = next.layers.find((l) => l.id === r.layerId)?.channels[r.property];
    const idx = ch?.keyframes.findIndex((k) => (k as Keyframe & { __tag?: symbol }).__tag === tag) ?? -1;
    if (idx >= 0) out.push({ ...r, index: idx });
  }
  next = { ...next, layers: next.layers.map((l) => ({ ...l, channels: Object.fromEntries(Object.entries(l.channels).map(([p, ch]) => [p, { ...ch!, keyframes: ch!.keyframes.map((k) => { const { __tag, ...rest } = k as Keyframe & { __tag?: symbol }; void __tag; return rest; }) }])) })) };
  return { anim: next, refs: out };
}

export function moveKeys(anim: Animation, refs: KeyRef[], dt: number, original: Animation = anim): { anim: Animation; refs: KeyRef[] } {
  return mapKeys(anim, refs, (k, r) => ({ ...k, time: Math.max(0, Math.min(anim.duration, (getKey(original, r)?.time ?? k.time) + dt)) }));
}

/** Time scaling (§10.3): retime a selection proportionally about a pivot. */
export function scaleKeys(anim: Animation, refs: KeyRef[], pivot: number, factor: number): { anim: Animation; refs: KeyRef[] } {
  return mapKeys(anim, refs, (k) => ({ ...k, time: Math.max(0, Math.min(anim.duration, pivot + (k.time - pivot) * factor)) }));
}

/** Reverse a selection in time; each segment's handles swap and mirror so the motion plays backwards. */
export function reverseKeys(anim: Animation, refs: KeyRef[]): { anim: Animation; refs: KeyRef[] } {
  const times = refs.map((r) => getKey(anim, r)!.time);
  const lo = Math.min(...times), hi = Math.max(...times);
  const mirror = (h: BezierHandle): BezierHandle => ({ x: h.x.map((x) => 1 - x), y: h.y.map((y) => 1 - y) });
  return mapKeys(anim, refs, (k) => ({ ...k, time: hi - (k.time - lo), easeOut: mirror(k.easeIn), easeIn: mirror(k.easeOut), spatialOut: k.spatialIn, spatialIn: k.spatialOut }));
}

export function deleteKeys(anim: Animation, refs: KeyRef[]): Animation {
  const kill = new Set(refs.map(keyId));
  return {
    ...anim,
    layers: anim.layers.map((l) => ({
      ...l,
      channels: Object.fromEntries(Object.entries(l.channels).map(([p, ch]) => [p, { ...ch!, keyframes: ch!.keyframes.filter((_, i) => !kill.has(`${l.id}/${p}/${i}`)) }])),
    })),
  };
}

export function setSegmentBezier(anim: Animation, left: KeyRef, b: { x1: number; y1: number; x2: number; y2: number }): Animation {
  return mapLayer(anim, left.layerId, (l) => {
    const ch = l.channels[left.property];
    if (!ch || left.index >= ch.keyframes.length - 1) return l;
    const kfs = ch.keyframes.map((k, i) => {
      if (i === left.index) { const { easeFn, ...rest } = k; void easeFn; return { ...rest, easeOut: { x: [b.x1], y: [b.y1] } }; }
      if (i === left.index + 1) return { ...k, easeIn: { x: [b.x2], y: [b.y2] } };
      return k;
    });
    return { ...l, channels: { ...l.channels, [left.property]: { ...ch, keyframes: kfs } } };
  });
}
