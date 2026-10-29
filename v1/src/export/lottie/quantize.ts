/** Frame quantization (§8.3): fractional frames are legal but often rounded. */
import type { Animation, Channel } from "../../model/types.js";

export function quantizationReport(ch: Channel, frameRate: number): { offFrame: number; maxShiftFrames: number } {
  let off = 0, max = 0;
  for (const k of ch.keyframes) {
    const f = k.time * frameRate, d = Math.abs(f - Math.round(f));
    if (d > 1e-6) { off++; max = Math.max(max, d); }
  }
  return { offFrame: off, maxShiftFrames: max };
}

/** "Snap to frames" (§8.3): quantize every keyframe time in the model. */
export function snapToFrames(anim: Animation): Animation {
  const q = (t: number) => Math.round(t * anim.frameRate) / anim.frameRate;
  return { ...anim, layers: anim.layers.map((l) => ({ ...l, channels: Object.fromEntries(Object.entries(l.channels).map(([p, ch]) => [p, { ...ch!, keyframes: ch!.keyframes.map((k) => ({ ...k, time: q(k.time) })) }])) })) };
}
