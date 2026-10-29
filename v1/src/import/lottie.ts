/**
 * Lottie import (M7) for the subset in lottie-subset.md. Anything outside it
 * is an ImportIssue, not a silent drop: errors stop the import, warnings
 * describe what was simplified.
 */
import { parsePath, toPathData, type SubPath } from "./svgpath.js";
import type { Animation, BezierHandle, Channel, Color, Keyframe, Layer, LayerContent, PropertyName, Value } from "../model/types.js";
import { PROPERTY_TYPES } from "../model/types.js";
import { apply, mul, rotate, scale, translate, type Mat } from "../model/transform.js";
import { bake, unionTimes } from "../export/bake.js";
import { evaluateChannel } from "../model/evaluate.js";
import { LINEAR_IN, LINEAR_OUT } from "../model/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

export interface ImportIssue { severity: "error" | "warning"; layer?: string; message: string }
export interface ImportResult { animation: Animation | null; issues: ImportIssue[] }

const arrify = (v: J): number[] => (Array.isArray(v) ? v : [v]);
const handle = (h: J | undefined, fallback: BezierHandle): BezierHandle => (h ? { x: arrify(h.x), y: arrify(h.y) } : fallback);

function readProp(p: J, fr: number, prop: PropertyName, map: (v: number[]) => Value, issues: ImportIssue[], layer: string): Channel | undefined {
  if (!p) return undefined;
  if (p.x !== undefined && typeof p.x === "string") issues.push({ severity: "warning", layer, message: `${prop}: expression ignored` });
  const type = PROPERTY_TYPES[prop];
  if (!p.a) return { property: prop, type, spatial: prop === "position", keyframes: [{ time: 0, value: map(arrify(p.k)), easeOut: LINEAR_OUT, easeIn: LINEAR_IN }] };
  const ks: J[] = p.k;
  const kfs: Keyframe[] = ks.map((k: J, i: number) => {
    // Legacy files store the segment end in `e`; modern ones use the next `s`.
    const value = k.s !== undefined ? k.s : ks[i - 1]?.e;
    const prev = ks[i - 1];
    const kf: Keyframe = {
      time: k.t / fr,
      value: map(arrify(value)),
      easeOut: handle(k.o, LINEAR_OUT),
      easeIn: handle(prev?.i, LINEAR_IN),
    };
    if (k.h === 1) kf.hold = true;
    if (k.to) kf.spatialOut = [k.to[0], k.to[1]];
    if (prev?.ti) kf.spatialIn = [prev.ti[0], prev.ti[1]];
    return kf;
  });
  // Lottie puts `ti` on the segment's left keyframe; it's the right keyframe's in-tangent here (done above).
  return { property: prop, type, spatial: prop === "position", keyframes: kfs.filter((k) => Array.isArray(k.value) ? k.value.every(Number.isFinite) : Number.isFinite(k.value)) };
}

const vec2 = (v: number[]) => [v[0] ?? 0, v[1] ?? 0];
const num = (v: number[]) => v[0] ?? 0;

function shapeToSubs(it: J, issues: ImportIssue[], layer: string): SubPath[] {
  const out: SubPath[] = [];
  const static_ = (p: J) => { if (p?.a) issues.push({ severity: "warning", layer, message: `animated shape geometry (${it.ty}) imported at its first keyframe` }); return p?.a ? arrify(p.k[0].s) : arrify(p?.k ?? 0); };
  if (it.ty === "rc") {
    const [w, h] = static_(it.s), [cx, cy] = static_(it.p);
    out.push(...parsePath(`M${cx! - w! / 2} ${cy! - h! / 2}H${cx! + w! / 2}V${cy! + h! / 2}H${cx! - w! / 2}Z`));
  } else if (it.ty === "el") {
    const [w, h] = static_(it.s), [cx, cy] = static_(it.p);
    const rx = w! / 2, ry = h! / 2;
    out.push(...parsePath(`M${cx! - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx! + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx! - rx} ${cy}Z`));
  } else if (it.ty === "sh") {
    const k = it.ks.a ? (issues.push({ severity: "warning", layer, message: "animated path imported at its first keyframe" }), it.ks.k[0].s[0]) : it.ks.k;
    const v: number[][] = k.v, ii: number[][] = k.i, oo: number[][] = k.o;
    if (!v.length) return out;
    const sub: SubPath = { start: [v[0]![0]!, v[0]![1]!], segments: [], closed: !!k.c };
    const n = v.length;
    for (let j = 1; j < n + (k.c ? 1 : 0); j++) {
      const a = v[(j - 1) % n]!, b = v[j % n]!, ao = oo[(j - 1) % n]!, bi = ii[j % n]!;
      sub.segments.push([a[0]! + ao[0]!, a[1]! + ao[1]!, b[0]! + bi[0]!, b[1]! + bi[1]!, b[0]!, b[1]!]);
    }
    out.push(sub);
  }
  return out;
}

function transformSubs(subs: SubPath[], m: Mat): SubPath[] {
  const p = (x: number, y: number) => apply(m, x, y);
  return subs.map((s) => ({ start: p(...s.start), closed: s.closed, segments: s.segments.map((c) => [...p(c[0], c[1]), ...p(c[2], c[3]), ...p(c[4], c[5])] as SubPath["segments"][number]) }));
}

function readShapes(shapes: J[], issues: ImportIssue[], layer: string): { content: LayerContent; fill?: J } {
  let subs: SubPath[] = [];
  let fill: J | undefined;
  let simple: LayerContent | null = null;
  let count = 0;
  const walk = (items: J[], m: Mat) => {
    const tr = items.find((i: J) => i.ty === "tr");
    let local = m;
    if (tr) {
      const g = (p: J, d: number[]) => (p ? (p.a ? (issues.push({ severity: "warning", layer, message: "animated group transform imported at its first keyframe" }), arrify(p.k[0].s)) : arrify(p.k)) : d);
      const [px, py] = g(tr.p, [0, 0]), [ax, ay] = g(tr.a, [0, 0]), [sx, sy] = g(tr.s, [100, 100]), [r] = g(tr.r, [0]);
      local = mul(m, mul(mul(translate(px!, py!), rotate(r!)), mul(scale(sx! / 100, sy! / 100), translate(-ax!, -ay!))));
    }
    for (const it of items) {
      if (it.ty === "gr") walk(it.it, local);
      else if (it.ty === "fl") { if (!fill) fill = it; else issues.push({ severity: "warning", layer, message: "only the first fill is imported" }); }
      else if (it.ty === "rc" || it.ty === "el" || it.ty === "sh") {
        count++;
        const identity = local.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]!) < 1e-9);
        const s = (p: J) => (p?.a ? arrify(p.k[0].s) : arrify(p?.k ?? 0));
        if (identity && it.ty !== "sh" && count === 1) {
          const [w, h] = s(it.s), [cx, cy] = s(it.p);
          if (Math.abs(cx! - w! / 2) < 1e-6 && Math.abs(cy! - h! / 2) < 1e-6) simple = it.ty === "rc" ? { kind: "rect", width: w!, height: h!, ...(s(it.r)[0] ? { radius: s(it.r)[0]! } : {}) } : { kind: "ellipse", width: w!, height: h! };
        }
        subs.push(...transformSubs(shapeToSubs(it, issues, layer), local));
      } else if (it.ty !== "tr") issues.push({ severity: "warning", layer, message: `shape item "${it.ty}" (${({ st: "stroke", gf: "gradient fill", gs: "gradient stroke", tm: "trim paths", rp: "repeater", mm: "merge paths", rd: "round corners" } as Record<string, string>)[it.ty] ?? "unknown"}) is outside the subset and was skipped` });
    }
  };
  walk(shapes, [1, 0, 0, 1, 0, 0]);
  if (count === 1 && simple) return { content: simple, fill };
  // Normalise the path into the layer's own box: content spans [0, w] × [0, h] only if min ≥ 0, so keep coordinates as authored.
  let w = 0, h = 0;
  for (const sp of subs) for (const p of [sp.start, ...sp.segments.flatMap((c) => [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]] as Array<[number, number]>)]) { w = Math.max(w, p[0]); h = Math.max(h, p[1]); }
  return { content: { kind: "path", d: toPathData(subs), width: Math.ceil(w), height: Math.ceil(h) }, fill };
}

/** Lottie split position (px, py separately keyed) → one vector channel, baking where the dimensions disagree (§9.5). */
function combineSplit(x: Channel, y: Channel): Channel {
  const same = x.keyframes.length === y.keyframes.length && x.keyframes.every((k, i) => Math.abs(k.time - y.keyframes[i]!.time) < 1e-9);
  if (same) {
    return { property: "position", type: "vector2", spatial: true, keyframes: x.keyframes.map((k, i) => {
      const ky = y.keyframes[i]!;
      return { time: k.time, value: [k.value as number, ky.value as number], easeOut: { x: [k.easeOut.x[0]!, ky.easeOut.x[0]!], y: [k.easeOut.y[0]!, ky.easeOut.y[0]!] }, easeIn: { x: [k.easeIn.x[0]!, ky.easeIn.x[0]!], y: [k.easeIn.y[0]!, ky.easeIn.y[0]!] }, ...(k.hold && ky.hold ? { hold: true } : {}) };
    }) };
  }
  const times = unionTimes([x.keyframes.map((k) => k.time), y.keyframes.map((k) => k.time)]);
  const f = (t: number) => [evaluateChannel(x, t) as number, evaluateChannel(y, t) as number];
  const kfs: Keyframe[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const r = bake(f, times[i]!, times[i + 1]!, 0.1);
    r.times.slice(0, -1).forEach((t, j) => kfs.push({ time: t, value: r.values[j]!, easeOut: LINEAR_OUT, easeIn: LINEAR_IN }));
  }
  kfs.push({ time: times[times.length - 1]!, value: f(times[times.length - 1]!), easeOut: LINEAR_OUT, easeIn: LINEAR_IN });
  return { property: "position", type: "vector2", spatial: true, keyframes: kfs };
}

export function importLottie(input: string | J): ImportResult {
  const issues: ImportIssue[] = [];
  let j: J;
  try { j = typeof input === "string" ? JSON.parse(input) : input; } catch (e) { return { animation: null, issues: [{ severity: "error", message: `not JSON: ${(e as Error).message}` }] }; }
  if (!j || typeof j.fr !== "number" || !Array.isArray(j.layers)) return { animation: null, issues: [{ severity: "error", message: "not a Lottie file (missing fr or layers)" }] };
  const fr = j.fr;
  const ip = j.ip ?? 0;
  if (j.ddd === 1) issues.push({ severity: "error", message: "3D compositions are outside the subset" });
  const byInd = new Map<number, string>();
  const layers: Layer[] = [];
  let background: Color | undefined;
  for (const [idx, L] of [...j.layers].reverse().entries()) {
    const name = L.nm ?? `Layer ${idx + 1}`;
    const id = `l${L.ind ?? idx + 1}`;
    if (L.ind !== undefined) byInd.set(L.ind, id);
    const unsupported: Record<number, string> = { 0: "precomp", 1: "solid", 2: "image", 5: "text", 6: "audio", 13: "camera" };
    if (L.ty !== 4 && L.ty !== 3) { issues.push({ severity: unsupported[L.ty] ? "error" : "error", layer: name, message: `${unsupported[L.ty] ?? `type ${L.ty}`} layers are outside the subset` }); continue; }
    if (L.ddd === 1) issues.push({ severity: "error", layer: name, message: "3D layer" });
    if (L.hasMask || L.masksProperties) issues.push({ severity: "error", layer: name, message: "masks are outside the subset" });
    if (L.tt) issues.push({ severity: "error", layer: name, message: "track mattes are outside the subset" });
    if (L.ef?.length) issues.push({ severity: "warning", layer: name, message: "effects skipped" });
    if (L.tm) issues.push({ severity: "error", layer: name, message: "time remapping is outside the subset" });
    if ((L.sr ?? 1) !== 1) issues.push({ severity: "warning", layer: name, message: "time stretch ignored" });
    if ((L.st ?? 0) !== 0) issues.push({ severity: "warning", layer: name, message: "start-time offset ignored" });
    const ks = L.ks ?? {};
    const channels: Partial<Record<PropertyName, Channel>> = {};
    const set = (p: PropertyName, ch?: Channel) => { if (ch) channels[p] = ch; };
    set("anchor", readProp(ks.a, fr, "anchor", vec2, issues, name));
    if (ks.p?.s) {
      const x = readProp(ks.p.x, fr, "position", num, issues, name), y = readProp(ks.p.y, fr, "position", num, issues, name);
      if (x && y) set("position", combineSplit({ ...x, type: "number" }, { ...y, type: "number" }));
    } else set("position", readProp(ks.p, fr, "position", vec2, issues, name));
    set("scale", readProp(ks.s, fr, "scale", vec2, issues, name));
    set("rotation", readProp(ks.r ?? ks.rz, fr, "rotation", num, issues, name));
    set("opacity", readProp(ks.o, fr, "opacity", num, issues, name));
    let content: LayerContent = { kind: "null", width: 0, height: 0 };
    if (L.ty === 4) {
      const s = readShapes(L.shapes ?? [], issues, name);
      content = s.content;
      if (s.fill) { const f = readProp(s.fill.c, fr, "fill", (v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1] as Color, issues, name); if (f) set("fill", { ...f, colorSpace: "srgb" }); }
      // Our own background layer round-trips as Animation.background.
      if (name === "Background" && content.kind === "rect" && content.width === j.w && content.height === j.h && !Object.values(channels).some((c) => c!.keyframes.length > 1)) {
        background = channels.fill?.keyframes[0]?.value as Color;
        continue;
      }
    }
    // Shift so the composition starts at 0.
    const shift = (ch: Channel): Channel => ({ ...ch, keyframes: ch.keyframes.map((k) => ({ ...k, time: k.time - ip / fr })) });
    for (const p of Object.keys(channels) as PropertyName[]) channels[p] = shift(channels[p]!);
    layers.push({ id, name, content, channels, inPoint: Math.max(0, ((L.ip ?? ip) - ip) / fr), outPoint: Math.max(0, ((L.op ?? j.op) - ip) / fr), ...(L.parent !== undefined ? { parent: `__ind${L.parent}` } : {}) });
  }
  for (const l of layers) if (l.parent?.startsWith("__ind")) {
    const target = byInd.get(Number(l.parent.slice(5)));
    if (target) l.parent = target;
    else { issues.push({ severity: "warning", layer: l.name, message: "parent not found; unparented" }); delete l.parent; }
  }
  if (issues.some((i) => i.severity === "error")) return { animation: null, issues };
  return { animation: { name: j.nm ?? "Imported", width: j.w, height: j.h, duration: (j.op - ip) / fr, frameRate: fr, layers, ...(background ? { background } : {}) }, issues };
}
