/**
 * Layer transforms. TRS composition (the default) is Lottie's and CSS's
 * individual-property order: M = T(position) · R(rotation) · S(scale) · T(−anchor).
 * RTS composition rotates about `orbitCenter` first — orbital motion (§9.2):
 * M = T(c) · R(rotation) · T(−c) · T(position) · S(scale) · T(−anchor).
 * Parenting multiplies the parent's matrix on the left (opacity does not inherit, as in Lottie).
 */
import { layerState } from "./evaluate.js";
import type { Animation, Layer } from "./types.js";

/** 2D affine [a, b, c, d, e, f] as in DOMMatrix / canvas setTransform. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function localMatrix(layer: Layer, time: number): Mat {
  const s = layerState(layer, time);
  const tail = mul(scale(s.scale[0] / 100, s.scale[1] / 100), translate(-s.anchor[0], -s.anchor[1]));
  if (layer.transformOrder === "RTS") {
    const c = layer.orbitCenter ?? [0, 0];
    return mul(mul(mul(translate(c[0], c[1]), rotate(s.rotation)), translate(-c[0], -c[1])), mul(translate(s.position[0], s.position[1]), tail));
  }
  return mul(mul(translate(s.position[0], s.position[1]), rotate(s.rotation)), tail);
}

export function worldMatrix(anim: Animation, layer: Layer, time: number, depth = 0): Mat {
  const local = localMatrix(layer, time);
  if (!layer.parent || depth > 32) return local;
  const parent = anim.layers.find((l) => l.id === layer.parent);
  return parent ? mul(worldMatrix(anim, parent, time, depth + 1), local) : local;
}
