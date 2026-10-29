/** sRGB ↔ OKLab (Ottosson) for perceptual colour interpolation (§6.3). */
import type { Color } from "./types.js";

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function srgbToOklab([r, g, b]: Color | number[]): [number, number, number] {
  const lr = toLinear(r!), lg = toLinear(g!), lb = toLinear(b!);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklabToSrgb([L, a, b]: number[]): [number, number, number] {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  const c = (v: number) => Math.min(1, Math.max(0, toGamma(v)));
  return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

/** Perceptual interpolation: OKLab for colour, linear for alpha. */
export function lerpColorOklab(a: Color, b: Color, t: number): Color {
  const A = srgbToOklab(a), B = srgbToOklab(b);
  const [r, g, bl] = oklabToSrgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  return [r, g, bl, a[3] + (b[3] - a[3]) * t];
}

/** What Lottie players and legacy CSS do: component-wise sRGB lerp. */
export function lerpColorSrgb(a: Color, b: Color, t: number): Color {
  return [0, 1, 2, 3].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Color;
}

/** ΔE in OKLab ×100 (≈2 is just noticeable). */
export function deltaE(a: Color, b: Color): number {
  const A = srgbToOklab(a), B = srgbToOklab(b);
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

export function colorToCss(c: Color): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return c[3] >= 1 ? `rgb(${h(c[0])} ${h(c[1])} ${h(c[2])})` : `rgb(${h(c[0])} ${h(c[1])} ${h(c[2])} / ${+c[3].toFixed(4)})`;
}

export function parseHex(hex: string): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`bad colour ${hex}`);
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255, m[4] ? parseInt(m[4], 16) / 255 : 1];
}
