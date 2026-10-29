/**
 * SVG import for layer content (M7): each rect, circle, ellipse, polygon,
 * polyline and path becomes a layer. Geometry is normalised so the layer's
 * box starts at (0, 0), positioned where it was drawn, with the anchor at the
 * box centre so it rotates and scales about itself.
 * A small tag scanner rather than a DOM, so it runs in Node too.
 */
import { parseHex } from "../model/color.js";
import { apply, mul, rotate, scale, translate, type Mat } from "../model/transform.js";
import { cubicPoint } from "../model/spatial.js";
import type { Animation, Color, Layer, LayerContent } from "../model/types.js";
import { keyframe } from "../model/types.js";
import { parsePath, toPathData, type SubPath } from "./svgpath.js";

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080" };

function color(v: string | undefined): Color | null {
  if (!v || v === "none") return null;
  v = v.trim().toLowerCase();
  if (NAMED[v]) v = NAMED[v]!;
  if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return parseHex(v);
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0]! / 255, p[1]! / 255, p[2]! / 255, p[3] ?? 1]; }
  return null;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[3] ?? m[4] ?? "";
  const style = out.style;
  if (style) for (const decl of style.split(";")) { const [k, v] = decl.split(":"); if (k && v) out[k.trim()] = v.trim(); }
  return out;
}

function parseTransform(t: string | undefined): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const f of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = f[2]!.split(/[ ,]+/).filter(Boolean).map(Number);
    switch (f[1]) {
      case "translate": m = mul(m, translate(a[0] ?? 0, a[1] ?? 0)); break;
      case "scale": m = mul(m, scale(a[0] ?? 1, a[1] ?? a[0] ?? 1)); break;
      case "rotate": m = a.length === 3 ? mul(m, mul(mul(translate(a[1]!, a[2]!), rotate(a[0]!)), translate(-a[1]!, -a[2]!))) : mul(m, rotate(a[0] ?? 0)); break;
      case "matrix": m = mul(m, a as Mat); break;
    }
  }
  return m;
}

function bbox(subs: SubPath[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) {
    let p = s.start;
    const add = (q: [number, number]) => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); };
    add(p);
    for (const c of s.segments) { for (let t = 0.05; t <= 1.0001; t += 0.05) add(cubicPoint(p, [c[0], c[1]], [c[2], c[3]], [c[4], c[5]], t)); p = [c[4], c[5]]; }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function importSvg(svg: string, opts: { duration?: number; frameRate?: number } = {}): { animation: Animation; skipped: string[] } {
  const root = /<svg\b[^>]*>/i.exec(svg);
  const ra = root ? attrs(root[0]) : {};
  const vb = ra.viewBox?.split(/[ ,]+/).map(Number);
  const width = Number.parseFloat(ra.width ?? "") || vb?.[2] || 512, height = Number.parseFloat(ra.height ?? "") || vb?.[3] || 512;
  const layers: Layer[] = [];
  const skipped: string[] = [];
  const groupStack: Array<{ m: Mat; fill?: string }> = [{ m: vb ? translate(-vb[0]!, -vb[1]!) : [1, 0, 0, 1, 0, 0] }];
  let n = 0;
  for (const tagM of svg.matchAll(/<\/?([a-zA-Z]+)\b[^>]*?\/?>/g)) {
    const tag = tagM[0], name = tagM[1]!.toLowerCase();
    if (tag.startsWith("</")) { if (name === "g") groupStack.pop(); continue; }
    const a = attrs(tag);
    const parent = groupStack[groupStack.length - 1]!;
    if (name === "g") { if (!tag.endsWith("/>")) groupStack.push({ m: mul(parent.m, parseTransform(a.transform)), ...(a.fill ?? parent.fill ? { fill: a.fill ?? parent.fill } : {}) }); continue; }
    let d: string | null = null;
    const N = (k: string, def = 0) => Number.parseFloat(a[k] ?? "") || def;
    switch (name) {
      case "rect": { const x = N("x"), y = N("y"), w = N("width"), h = N("height"); d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`; break; }
      case "circle": { const cx = N("cx"), cy = N("cy"), r = N("r"); d = `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`; break; }
      case "ellipse": { const cx = N("cx"), cy = N("cy"), rx = N("rx"), ry = N("ry"); d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`; break; }
      case "polygon": case "polyline": { const p = (a.points ?? "").trim().split(/[ ,]+/).map(Number); d = `M${p.slice(0, 2).join(" ")}` + p.slice(2).reduce((s, v, i) => s + (i % 2 ? ` ${v}` : `L${v}`), "") + (name === "polygon" ? "Z" : ""); break; }
      case "path": d = a.d ?? null; break;
      case "svg": case "defs": case "title": case "desc": case "metadata": continue;
      default: if (!["stop", "lineargradient", "radialgradient", "style", "clippath", "mask", "use", "text", "tspan", "image"].includes(name)) continue; skipped.push(name); continue;
    }
    if (!d) continue;
    const fill = color(a.fill ?? parent.fill ?? "#000000");
    if (!fill) { skipped.push(`${name} with no fill (strokes are outside the subset)`); continue; }
    const m = mul(parent.m, parseTransform(a.transform));
    let subs = parsePath(d).map((s) => ({ start: apply(m, ...s.start), closed: s.closed, segments: s.segments.map((c) => [...apply(m, c[0], c[1]), ...apply(m, c[2], c[3]), ...apply(m, c[4], c[5])] as SubPath["segments"][number]) }));
    const box = bbox(subs);
    subs = subs.map((s) => ({ start: [s.start[0] - box.x, s.start[1] - box.y], closed: s.closed, segments: s.segments.map((c) => [c[0] - box.x, c[1] - box.y, c[2] - box.x, c[3] - box.y, c[4] - box.x, c[5] - box.y] as SubPath["segments"][number]) }));
    const op = Number.parseFloat(a.opacity ?? a["fill-opacity"] ?? "1");
    const content: LayerContent = { kind: "path", d: toPathData(subs), width: Math.ceil(box.w), height: Math.ceil(box.h) };
    n++;
    const duration = opts.duration ?? 2;
    layers.push({
      id: a.id ? a.id.replace(/[^a-zA-Z0-9_-]/g, "_") : `svg${n}`,
      name: a.id ?? `${name} ${n}`,
      content,
      channels: {
        anchor: { property: "anchor", type: "vector2", spatial: false, keyframes: [keyframe(0, [box.w / 2, box.h / 2])] },
        position: { property: "position", type: "vector2", spatial: true, keyframes: [keyframe(0, [box.x + box.w / 2, box.y + box.h / 2])] },
        fill: { property: "fill", type: "color", spatial: false, keyframes: [keyframe(0, [fill[0], fill[1], fill[2], 1])] },
        ...(op < 1 ? { opacity: { property: "opacity" as const, type: "number" as const, spatial: false, keyframes: [keyframe(0, op * 100)] } } : {}),
      },
      inPoint: 0,
      outPoint: duration,
    });
  }
  return { animation: { name: "Imported SVG", width, height, duration: opts.duration ?? 2, frameRate: opts.frameRate ?? 60, layers }, skipped };
}
