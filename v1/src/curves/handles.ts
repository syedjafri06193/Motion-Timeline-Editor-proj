/**
 * Curve-editor maths, separate from drawing so it can be tested.
 * - Segment view (§11.1): the normalised 0–1 bezier for one segment.
 * - Value graph (§11.1, M8): value against time; a keyframe's tangent handle
 *   is its bezier handle scaled into the segment's time × value box.
 */
import type { BezierHandle, Keyframe } from "../model/types.js";

export type ExportTarget = "lottie" | "css" | "both";

/** §11.2: x must stay in [0, 1] when CSS is a target (monotonic time). y is free: overshoot. */
export function clampHandle(h: { x: number; y: number }, target: ExportTarget): { x: number; y: number; clamped: boolean } {
  if (target === "lottie") return { ...h, clamped: false };
  const x = Math.min(1, Math.max(0, h.x));
  return { x, y: h.y, clamped: x !== h.x };
}

const dim = (h: BezierHandle, d: number) => ({ x: h.x[Math.min(d, h.x.length - 1)]!, y: h.y[Math.min(d, h.y.length - 1)]! });

/** Set dimension d of a handle, expanding a shared handle to per-dimension only when needed. */
export function setHandleDim(h: BezierHandle, d: number, dims: number, v: { x: number; y: number }): BezierHandle {
  if (dims === 1) return { x: [v.x], y: [v.y] };
  const xs = Array.from({ length: dims }, (_, i) => dim(h, i).x), ys = Array.from({ length: dims }, (_, i) => dim(h, i).y);
  xs[d] = v.x; ys[d] = v.y;
  // Collapse back to shared when every dimension agrees.
  if (xs.every((x) => x === xs[0]) && ys.every((y) => y === ys[0])) return { x: [xs[0]!], y: [ys[0]!] };
  return { x: xs, y: ys };
}

/** Value-graph positions (time, value) of the out handle of a and the in handle of b, for dimension d. */
export function graphHandles(a: Keyframe, b: Keyframe, d: number): { out: [number, number]; in: [number, number] } {
  const av = typeof a.value === "number" ? a.value : a.value[d]!, bv = typeof b.value === "number" ? b.value : b.value[d]!;
  const dt = b.time - a.time, dv = bv - av;
  const o = dim(a.easeOut, d), i = dim(b.easeIn, d);
  return { out: [a.time + o.x * dt, av + o.y * dv], in: [a.time + i.x * dt, av + i.y * dv] };
}

/** Inverse: a dragged graph handle back to normalised bezier coordinates. */
export function handleFromGraph(a: Keyframe, b: Keyframe, d: number, p: [number, number]): { x: number; y: number } {
  const av = typeof a.value === "number" ? a.value : a.value[d]!, bv = typeof b.value === "number" ? b.value : b.value[d]!;
  const dt = b.time - a.time, dv = bv - av;
  return { x: (p[0] - a.time) / dt, y: dv === 0 ? 0 : (p[1] - av) / dv };
}
