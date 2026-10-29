/**
 * Spatial bezier motion (§8.4, §9.4). Between keyframes a and b the path is the
 * cubic a → a+spatialOut → b+spatialIn → b. Eased progress is distance along
 * the path (arc length), as After Effects and lottie-web interpret it, so the
 * preview, the Lottie export and the CSS offset-path export all agree.
 */
export type Vec2 = [number, number];

export function cubicPoint(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

const SEGMENTS = 200;

export interface ArcTable {
  ts: Float64Array;
  lengths: Float64Array; // cumulative
  total: number;
}

const tables = new WeakMap<object, ArcTable>();

export function arcTable(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, key?: object): ArcTable {
  if (key) {
    const hit = tables.get(key);
    if (hit) return hit;
  }
  const ts = new Float64Array(SEGMENTS + 1), lengths = new Float64Array(SEGMENTS + 1);
  let prev = p0, total = 0;
  for (let i = 1; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const p = cubicPoint(p0, c1, c2, p3, t);
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    ts[i] = t;
    lengths[i] = total;
    prev = p;
  }
  const table = { ts, lengths, total };
  if (key) tables.set(key, table);
  return table;
}

/** Point at fraction `s` of the arc length. */
export function pointAtDistance(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, s: number, key?: object): Vec2 {
  const tab = arcTable(p0, c1, c2, p3, key);
  if (tab.total === 0) return [...p0];
  const target = Math.min(1, Math.max(0, s)) * tab.total;
  let lo = 0, hi = SEGMENTS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab.lengths[mid]! < target) lo = mid;
    else hi = mid;
  }
  const l0 = tab.lengths[lo]!, l1 = tab.lengths[hi]!;
  const f = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
  return cubicPoint(p0, c1, c2, p3, (lo + f) / SEGMENTS);
}

export function isCurved(out?: Vec2, inn?: Vec2): boolean {
  return !!((out && (out[0] !== 0 || out[1] !== 0)) || (inn && (inn[0] !== 0 || inn[1] !== 0)));
}
