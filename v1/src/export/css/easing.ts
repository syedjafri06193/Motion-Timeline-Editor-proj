/**
 * The CSS easing decision (§9.3): cubic-bezier() when the segment is one,
 * linear() when it isn't (bounce, elastic, spring), steps(1, end) for holds.
 * linear() points come from adaptive sampling (§15.1) — dense where the
 * curve bends, sparse where it doesn't.
 */
import { EASING_FUNCTIONS } from "../../easing/presets.js";
import type { Keyframe } from "../../model/types.js";

export interface Point { x: number; y: number }

export function adaptiveSample(at: (x: number) => number, tolerance: number, maxDepth = 9): Point[] {
  const pts: Point[] = [{ x: 0, y: at(0) }];
  function subdivide(x0: number, y0: number, x1: number, y1: number, depth: number) {
    const xm = (x0 + x1) / 2, ym = at(xm);
    // Probe quarter points too: a bounce can pass through the chord's midpoint.
    const q1 = at((x0 + xm) / 2), q3 = at((xm + x1) / 2);
    const dev = Math.max(Math.abs(ym - (y0 + y1) / 2), Math.abs(q1 - (y0 * 3 + y1) / 4), Math.abs(q3 - (y0 + 3 * y1) / 4));
    if (depth < maxDepth && dev > tolerance) {
      subdivide(x0, y0, xm, ym, depth + 1);
      pts.push({ x: xm, y: ym });
      subdivide(xm, ym, x1, y1, depth + 1);
    }
  }
  // Seed with 8 intervals so oscillations can't hide between two samples.
  const n = 8;
  let px = 0, py = at(0);
  for (let i = 1; i <= n; i++) {
    const x = i / n, y = at(x);
    subdivide(px, py, x, y, 0);
    if (i < n) pts.push({ x, y });
    px = x; py = y;
  }
  pts.push({ x: 1, y: at(1) });
  return pts.sort((a, b) => a.x - b.x);
}

const f4 = (n: number) => +n.toFixed(4);

export function linearFunction(at: (x: number) => number, tolerance = 0.002): { css: string; points: number; maxError: number } {
  const pts = adaptiveSample(at, tolerance);
  const parts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? `${f4(p.y)}` : `${f4(p.y)} ${+(p.x * 100).toFixed(3)}%`));
  // Measure the piecewise-linear error densely.
  let maxError = 0;
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 1; k < 8; k++) {
      const x = pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * (k / 8);
      const lin = pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * (k / 8);
      maxError = Math.max(maxError, Math.abs(at(x) - lin));
    }
  return { css: `linear(${parts.join(", ")})`, points: pts.length, maxError };
}

export interface SegmentEasing {
  css: string;
  kind: "bezier" | "linear()" | "steps" | "linear";
  clamped: boolean;
  maxError: number;
}

/** CSS for the segment a → b, dimension d (vectors are handled by the caller). */
export function cssEasing(a: Keyframe, b: Keyframe, d = 0): SegmentEasing {
  if (a.hold) return { css: "steps(1, end)", kind: "steps", clamped: false, maxError: 0 };
  if (a.easeFn) {
    const l = linearFunction(EASING_FUNCTIONS[a.easeFn]);
    return { css: l.css, kind: "linear()", clamped: false, maxError: l.maxError };
  }
  const pick = (v: number[]) => v[Math.min(d, v.length - 1)]!;
  let x1 = pick(a.easeOut.x), x2 = pick(b.easeIn.x);
  const y1 = pick(a.easeOut.y), y2 = pick(b.easeIn.y);
  const clamped = x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1;
  x1 = Math.min(1, Math.max(0, x1));
  x2 = Math.min(1, Math.max(0, x2));
  if (x1 === y1 && x2 === y2) return { css: "linear", kind: "linear", clamped, maxError: 0 };
  return { css: `cubic-bezier(${f4(x1)}, ${f4(y1)}, ${f4(x2)}, ${f4(y2)})`, kind: "bezier", clamped, maxError: 0 };
}
