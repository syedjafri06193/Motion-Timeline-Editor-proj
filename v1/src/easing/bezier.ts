/**
 * Cubic-bezier easing (design guide §5). Easing is root-finding: solve
 * x(t) = x for the bezier parameter t, then evaluate y(t). Newton-Raphson with
 * a minimum-slope guard and a bisection fallback — the WebKit/Blink approach,
 * so the canvas preview agrees with the browser's CSS (verified in
 * tests/browser).
 */
export const NEWTON_ITERATIONS = 8;
export const NEWTON_MIN_SLOPE = 1e-3;
export const SUBDIVISION_PRECISION = 1e-7;
export const SUBDIVISION_MAX_ITERATIONS = 40;

/** Horner form of 3(1−t)²t·a + 3(1−t)t²·b + t³. */
export function sampleCurve(a: number, b: number, t: number): number {
  const c = 3 * a;
  const bb = 3 * (b - a) - c;
  const aa = 1 - c - bb;
  return ((aa * t + bb) * t + c) * t;
}

export function sampleDerivative(a: number, b: number, t: number): number {
  const c = 3 * a;
  const bb = 3 * (b - a) - c;
  const aa = 1 - c - bb;
  return (3 * aa * t + 2 * bb) * t + c;
}

/** Solve x(t) = x for t ∈ [0, 1]. x1, x2 must be in [0, 1] (monotonic time). */
export function solveT(x: number, x1: number, x2: number): number {
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const err = sampleCurve(x1, x2, t) - x;
    if (Math.abs(err) < SUBDIVISION_PRECISION) return t;
    const slope = sampleDerivative(x1, x2, t);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break; // flat: Newton diverges
    t -= err / slope;
  }
  // Bisection fallback. x(t) is monotonic for x1, x2 ∈ [0,1].
  let lo = 0,
    hi = 1;
  t = x;
  for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
    const cur = sampleCurve(x1, x2, t);
    if (Math.abs(cur - x) < SUBDIVISION_PRECISION) return t;
    if (cur > x) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return t;
}

export function easeAt(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x1 === y1 && x2 === y2) return x; // any curve on the diagonal is linear
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return sampleCurve(y1, y2, solveT(x, x1, x2));
}

/** The naive bug (§5.1), kept so tests can show how wrong it is. */
export function naiveEaseAt(x: number, _x1: number, y1: number, _x2: number, y2: number): number {
  return sampleCurve(y1, y2, x);
}

export interface CubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const LINEAR_BEZIER: CubicBezier = { x1: 0, y1: 0, x2: 1, y2: 1 };
