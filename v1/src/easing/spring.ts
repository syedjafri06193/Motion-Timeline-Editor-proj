/**
 * Spring easing (stretch goal §17): a damped harmonic oscillator from rest at
 * 0 toward 1, normalised so it ends at exactly 1. Not expressible as a cubic
 * bezier; exported through linear() (§9.3).
 */
export interface SpringParams {
  stiffness: number; // k
  damping: number; // c
  mass: number; // m
}

export const DEFAULT_SPRING: SpringParams = { stiffness: 170, damping: 12, mass: 1 };

/** Seconds until the spring settles within 0.1% — use as the segment's natural duration. */
export function springSettleTime(p: SpringParams): number {
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  const w0 = Math.sqrt(p.stiffness / p.mass);
  return Math.min(10, Math.log(1000) / (Math.max(zeta, 0.05) * w0));
}

/** Spring position at progress x ∈ [0,1] of the settle time. */
export function springAt(x: number, p: SpringParams = DEFAULT_SPRING): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const T = springSettleTime(p);
  const t = x * T;
  const w0 = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  let v: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    v = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    v = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    v = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  // Within 0.1% of rest at x = 1 by construction of the settle time; blend
  // the residual out over the last 10% so the segment lands exactly on 1.
  const blend = x > 0.9 ? (x - 0.9) / 0.1 : 0;
  return v + (1 - v) * blend;
}
