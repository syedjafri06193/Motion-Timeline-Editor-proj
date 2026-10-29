/**
 * The export capability matrix (design guide §3) as data. The exporters
 * consult it and the export dialog renders it; docs/export-matrix.md is
 * generated from the same rows (scripts/matrix-doc.ts), so they cannot drift.
 */
export type Support = "exact" | "approximated" | "baked" | "unrepresentable";

export interface Capability {
  id: string;
  label: string;
  lottie: Support;
  css: Support;
  notes: string;
}

export const CAPABILITIES: Capability[] = [
  { id: "per-property-times", label: "Per-property keyframe times", lottie: "exact", css: "exact", notes: "CSS: translate/rotate/scale/opacity/colour are separate @keyframes. X and Y share `translate`." },
  { id: "segment-easing", label: "Per-segment cubic-bezier easing", lottie: "exact", css: "exact", notes: "CSS: animation-timing-function inside the keyframe that starts the segment." },
  { id: "per-dimension-easing", label: "Per-dimension easing (X ≠ Y)", lottie: "exact", css: "baked", notes: "translate and scale are one property each; resampled and baked to tolerance." },
  { id: "spatial-path", label: "Spatial bezier motion path", lottie: "exact", css: "baked", notes: "Baked to keyframes, or exact with the offset-path option (motion along a path)." },
  { id: "easing-functions", label: "Bounce / elastic / spring", lottie: "baked", css: "approximated", notes: "CSS: linear() with adaptive sampling. Lottie has only beziers: baked to keyframes." },
  { id: "overshoot", label: "Overshoot (y outside [0, 1])", lottie: "exact", css: "exact", notes: "Legal in cubic-bezier() and linear()." },
  { id: "non-monotonic-time", label: "Handle x outside [0, 1]", lottie: "exact", css: "unrepresentable", notes: "cubic-bezier() requires x ∈ [0, 1]. Clamped, and reported." },
  { id: "transform-order", label: "Rotate-then-translate (orbital) order", lottie: "exact", css: "exact", notes: "Individual CSS properties are fixed T→R→S, so the orbit rotation goes on a wrapper element; Lottie uses a null parent." },
  { id: "anchor", label: "Animated anchor point", lottie: "exact", css: "exact", notes: "left/top/transform-origin animate together in one @keyframes; per-dimension anchor easing is baked." },
  { id: "drivers", label: "Drivers (property linked to another)", lottie: "baked", css: "baked", notes: "Neither target links properties without expressions; sampled to keyframes." },
  { id: "hold", label: "Hold / step keyframes", lottie: "exact", css: "exact", notes: "CSS: steps(1, end)." },
  { id: "color", label: "Perceptual (OKLab) colour interpolation", lottie: "baked", css: "baked", notes: "Both targets lerp sRGB; extra keyframes keep the path within ΔE 1." },
  { id: "rotation-accumulates", label: "Rotation beyond 360°", lottie: "exact", css: "exact", notes: "Stored unwrapped; both targets accumulate." },
  { id: "parenting", label: "Layer parenting", lottie: "exact", css: "exact", notes: "CSS: nested elements." },
  { id: "layer-timing", label: "Layer in/out points", lottie: "exact", css: "exact", notes: "CSS: a visibility animation with steps(1, end)." },
  { id: "fractional-frames", label: "Keyframes between frames", lottie: "approximated", css: "exact", notes: "Legal in Lottie but many players round; the analysis reports the maximum shift." },
];

export interface PropertyReport {
  path: string; // "layer3.position"
  fidelity: Support;
  reason?: string;
  bakedKeyframeCount?: number;
  /** In the property's own units (px, degrees, %, ΔE for colour). */
  maxError?: number;
}

export interface ExportAnalysis {
  target: "lottie" | "css";
  properties: PropertyReport[];
  warnings: string[];
}

export function worst(a: Support, b: Support): Support {
  const order: Support[] = ["exact", "approximated", "baked", "unrepresentable"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}

export function summarize(analysis: ExportAnalysis): string[] {
  return analysis.properties
    .filter((p) => p.fidelity !== "exact")
    .map((p) => `${p.path}: ${p.fidelity}${p.bakedKeyframeCount ? ` into ${p.bakedKeyframeCount} keyframes` : ""}${p.maxError !== undefined ? `, max deviation ${+p.maxError.toFixed(3)}` : ""}${p.reason ? ` — ${p.reason}` : ""}`);
}
