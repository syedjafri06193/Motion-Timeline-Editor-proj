/**
 * SVG path data → absolute cubic subpaths. Used for Lottie `sh` shapes and
 * SVG import (M7). Supports M L H V C S Q T Z, absolute and relative.
 * Arcs (A) are approximated by cubics.
 */
export interface SubPath {
  start: [number, number];
  segments: Array<[number, number, number, number, number, number]>; // c1x c1y c2x c2y x y
  closed: boolean;
}

export function parsePath(d: string): SubPath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: SubPath[] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lastC: [number, number] | null = null, lastQ: [number, number] | null = null;
  let cur: SubPath | null = null;
  const num = () => Number(tokens[i++]);
  const line = (nx: number, ny: number) => cur!.segments.push([x, y, nx, ny, nx, ny]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C !== "M" && !cur) { cur = { start: [x, y], segments: [], closed: false }; out.push(cur); }
    switch (C) {
      case "M": {
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        cur = { start: [x, y], segments: [], closed: false }; out.push(cur);
        cmd = rel ? "l" : "L"; lastC = lastQ = null; break;
      }
      case "L": { const nx = ox + num(), ny = oy + num(); line(nx, ny); x = nx; y = ny; lastC = lastQ = null; break; }
      case "H": { const nx = (rel ? x : 0) + num(); line(nx, y); x = nx; lastC = lastQ = null; break; }
      case "V": { const ny = (rel ? y : 0) + num(); line(x, ny); y = ny; lastC = lastQ = null; break; }
      case "C": {
        const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()] as const;
        cur!.segments.push([...a]); lastC = [a[2], a[3]]; x = a[4]; y = a[5]; lastQ = null; break;
      }
      case "S": {
        const c1x = lastC ? 2 * x - lastC[0] : x, c1y = lastC ? 2 * y - lastC[1] : y;
        const c2x = ox + num(), c2y = oy + num(), nx = ox + num(), ny = oy + num();
        cur!.segments.push([c1x, c1y, c2x, c2y, nx, ny]); lastC = [c2x, c2y]; x = nx; y = ny; lastQ = null; break;
      }
      case "Q": case "T": {
        let qx: number, qy: number;
        if (C === "Q") { qx = ox + num(); qy = oy + num(); } else { qx = lastQ ? 2 * x - lastQ[0] : x; qy = lastQ ? 2 * y - lastQ[1] : y; }
        const nx = ox + num(), ny = oy + num();
        cur!.segments.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
        lastQ = [qx, qy]; lastC = null; x = nx; y = ny; break;
      }
      case "A": {
        const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num(), nx = ox + num(), ny = oy + num();
        for (const s of arcToCubics(x, y, rx, ry, rot, !!large, !!sweep, nx, ny)) cur!.segments.push(s);
        x = nx; y = ny; lastC = lastQ = null; break;
      }
      case "Z": {
        if (cur) { if (x !== sx || y !== sy) line(sx, sy); cur.closed = true; }
        x = sx; y = sy; cur = null; lastC = lastQ = null; break;
      }
      default: throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return out;
}

function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: boolean, fs: boolean, x2: number, y2: number) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2] as [number, number, number, number, number, number]];
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: Array<[number, number, number, number, number, number]> = [];
  const k = (4 / 3) * Math.tan(dt / n / 4);
  for (let i = 0; i < n; i++) {
    const a1 = t1 + (dt * i) / n, a2 = t1 + (dt * (i + 1)) / n;
    const p = (a: number) => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp];
    const d = (a: number) => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp];
    const [p1x, p1y] = p(a1), [p2x, p2y] = p(a2), [d1x, d1y] = d(a1), [d2x, d2y] = d(a2);
    out.push([p1x! + k * d1x!, p1y! + k * d1y!, p2x! - k * d2x!, p2y! - k * d2y!, p2x!, p2y!]);
  }
  return out;
}

/** Back to path data (absolute cubics). */
export function toPathData(subs: SubPath[]): string {
  const f = (n: number) => +n.toFixed(3);
  return subs.map((s) => `M${f(s.start[0])} ${f(s.start[1])}` + s.segments.map((c) => `C${c.map(f).join(" ")}`).join("") + (s.closed ? "Z" : "")).join("");
}
