/**
 * Baking (§9.4, §9.5): replace a stretch of animation with keyframes joined by
 * linear segments, adaptively subdivided until the piecewise-linear result is
 * within tolerance of the original. Baked segments are linear because the
 * subdivision already encodes the shape (applying easing again would double
 * it), and sample *times* follow the true timing, so both path and speed are kept.
 */
export interface BakeResult {
  times: number[];
  values: number[][];
  maxError: number;
}

export type Sampler = (t: number) => number[];
export type Metric = (a: number[], b: number[]) => number;

export const euclid: Metric = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) * (v - b[i]!), 0));

function lerpVec(a: number[], b: number[], f: number) {
  return a.map((v, i) => v + (b[i]! - v) * f);
}

/**
 * Adaptive subdivision on [t0, t1]: split where the chord deviates from the
 * curve by more than `tolerance` at any of several probe points.
 * `minStep` stops runaway subdivision on discontinuities.
 */
export function bake(f: Sampler, t0: number, t1: number, tolerance: number, metric: Metric = euclid, minStep = 1 / 240): BakeResult {
  const times: number[] = [t0];
  const probes = [0.25, 0.5, 0.75];
  function split(a: number, b: number, fa: number[], fb: number[], depth: number) {
    let bad = false;
    if (b - a > minStep && depth < 16) {
      for (const p of probes) {
        const t = a + (b - a) * p;
        if (metric(f(t), lerpVec(fa, fb, p)) > tolerance) { bad = true; break; }
      }
    }
    if (bad) {
      const m = (a + b) / 2, fm = f(m);
      split(a, m, fa, fm, depth + 1);
      times.push(m);
      split(m, b, fm, fb, depth + 1);
    }
  }
  // Seed with a few uniform intervals so symmetric curves can't fool the midpoint test.
  const seeds = 4;
  const pts = Array.from({ length: seeds + 1 }, (_, i) => t0 + ((t1 - t0) * i) / seeds);
  for (let i = 0; i < seeds; i++) {
    split(pts[i]!, pts[i + 1]!, f(pts[i]!), f(pts[i + 1]!), 0);
    times.push(pts[i + 1]!);
  }
  const values = times.map(f);
  return { times, values, maxError: measure(f, times, values, metric) };
}

/** Dense measurement of the piecewise-linear error. */
export function measure(f: Sampler, times: number[], values: number[][], metric: Metric = euclid): number {
  let max = 0;
  for (let i = 0; i < times.length - 1; i++) {
    for (let k = 1; k < 16; k++) {
      const p = k / 16;
      const t = times[i]! + (times[i + 1]! - times[i]!) * p;
      max = Math.max(max, metric(f(t), lerpVec(values[i]!, values[i + 1]!, p)));
    }
  }
  return max;
}

/** Merge sorted time lists, dropping near-duplicates. */
export function unionTimes(lists: number[][], eps = 1e-9): number[] {
  const all = lists.flat().sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (!out.length || t - out[out.length - 1]! > eps) out.push(t);
  return out;
}
