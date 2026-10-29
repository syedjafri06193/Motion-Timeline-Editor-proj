/**
 * Lottie export (§8). The subset emitted is documented in
 * 1—Documentation/v1/lottie-subset.md: shape layers (rect, ellipse, path +
 * fill), null layers (for parenting and orbital rotation), transform
 * channels, per-dimension easing, spatial tangents, hold keyframes.
 */
import { animatedProperties } from "../../model/evaluate.js";
import { isCurved } from "../../model/spatial.js";
import type { Animation, Channel, Keyframe, Layer, PropertyName, Value } from "../../model/types.js";
import { STATIC_DEFAULTS } from "../../model/types.js";
import { parsePath } from "../../import/svgpath.js";
import { expandChannel } from "../expand.js";
import { worst, type ExportAnalysis, type PropertyReport, type Support } from "../matrix.js";
import { quantizationReport } from "./quantize.js";
import { bakeDrivers } from "../../model/drivers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

const arr = (v: Value): number[] => (typeof v === "number" ? [v] : [...v]);
const r = (n: number) => Math.round(n * 1e6) / 1e6;

function lottieKeyframes(ch: Channel, frameRate: number, map: (v: Value) => number[]): J[] {
  const kfs = ch.keyframes;
  return kfs.map((k, i): J => {
    const next = kfs[i + 1];
    const out: J = { t: r(k.time * frameRate), s: map(k.value).map(r) };
    if (!next) return out;
    if (k.hold) { out.h = 1; return out; }
    out.o = { x: k.easeOut.x.map(r), y: k.easeOut.y.map(r) };
    out.i = { x: next.easeIn.x.map(r), y: next.easeIn.y.map(r) };
    if (ch.spatial && isCurved(k.spatialOut, next.spatialIn)) {
      out.to = (k.spatialOut ?? [0, 0]).map(r);
      out.ti = (next.spatialIn ?? [0, 0]).map(r);
    }
    return out;
  });
}

function prop(ch: Channel | undefined, fallback: Value, frameRate: number, map: (v: Value) => number[] = arr): J {
  if (!ch || ch.keyframes.length === 0) return { a: 0, k: map(fallback).length === 1 ? map(fallback)[0] : map(fallback) };
  if (ch.keyframes.length === 1) { const v = map(ch.keyframes[0]!.value); return { a: 0, k: v.length === 1 ? v[0] : v }; }
  return { a: 1, k: lottieKeyframes(ch, frameRate, map) };
}

/** Segments Lottie can't express: easing functions (bounce/elastic/spring) and OKLab colour. */
function lottieNeedsBake(ch: Channel) {
  return (a: Keyframe, b: Keyframe) => !!a.easeFn || (ch.type === "color" && ch.colorSpace !== "srgb" && JSON.stringify(a.value) !== JSON.stringify(b.value));
}

function shapeFor(layer: Layer, fill: J): J[] {
  const c = layer.content;
  let shape: J;
  if (c.kind === "rect") shape = { ty: "rc", nm: "Rect", d: 1, s: { a: 0, k: [c.width, c.height] }, p: { a: 0, k: [c.width / 2, c.height / 2] }, r: { a: 0, k: c.radius ?? 0 } };
  else if (c.kind === "ellipse") shape = { ty: "el", nm: "Ellipse", d: 1, s: { a: 0, k: [c.width, c.height] }, p: { a: 0, k: [c.width / 2, c.height / 2] } };
  else if (c.kind === "null") return [];
  else {
    const subs = parsePath(c.d);
    return [{
      ty: "gr", nm: "Path",
      it: [
        ...subs.map((s, i) => {
          // Lottie vertices with in/out tangents relative to each vertex.
          const v: number[][] = [s.start], ii: number[][] = [[0, 0]], oo: number[][] = [];
          for (const seg of s.segments) {
            const prev = v[v.length - 1]!;
            oo.push([seg[0] - prev[0]!, seg[1] - prev[1]!]);
            v.push([seg[4], seg[5]]);
            ii.push([seg[2] - seg[4], seg[3] - seg[5]]);
          }
          oo.push([0, 0]);
          if (s.closed && v.length > 1) {
            // The closing segment returns to start: fold the duplicate end vertex into the first.
            const lastIn = ii.pop()!; v.pop(); oo.pop();
            ii[0] = lastIn;
          }
          return { ty: "sh", nm: `Path ${i + 1}`, ks: { a: 0, k: { i: ii.map((p) => p.map(r)), o: oo.map((p) => p.map(r)), v: v.map((p) => p.map(r)), c: s.closed } } };
        }),
        fill,
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ],
    }];
  }
  return [{ ty: "gr", nm: "Shape", it: [shape, fill, { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }];
}

export interface LottieExport {
  json: J;
  analysis: ExportAnalysis;
}

export function exportLottie(input: Animation): LottieExport {
  const { anim, baked: drivers } = bakeDrivers(input);
  const fr = anim.frameRate;
  const reports: PropertyReport[] = [];
  const warnings: string[] = [];
  const ind = new Map(anim.layers.map((l, i) => [l.id, i + 1]));
  let nextInd = anim.layers.length + 1;
  const out: J[] = [];

  for (const layer of anim.layers) {
    const chans: Partial<Record<PropertyName, Channel>> = {};
    for (const p of Object.keys(layer.channels) as PropertyName[]) {
      const ch = layer.channels[p]!;
      const e = expandChannel(ch, lottieNeedsBake(ch));
      chans[p] = { ...ch, keyframes: e.keyframes };
      if (animatedProperties(layer).includes(p)) {
        let fidelity: Support = e.bakedSegments ? "baked" : "exact";
        const q = quantizationReport(ch, fr);
        if (q.maxShiftFrames > 0) { fidelity = worst(fidelity, "approximated"); warnings.push(`${layer.name}.${p}: ${q.offFrame} keyframe(s) between frames; players that round would shift timing by up to ${q.maxShiftFrames.toFixed(2)} frame`); }
        reports.push({ path: `${layer.name}.${p}`, fidelity, ...(e.bakedSegments ? { bakedKeyframeCount: e.addedKeyframes, maxError: e.maxError, reason: ch.type === "color" ? "OKLab interpolation baked for sRGB players" : "easing function baked (Lottie has only beziers)" } : {}) });
      }
    }
    const alphas = (layer.channels.fill?.keyframes ?? []).map((k) => (k.value as number[])[3] ?? 1);
    if (alphas.some((a) => a < 1)) warnings.push(`${layer.name}.fill: colour alpha is not part of the Lottie subset (players ignore it); use opacity instead`);
    const fill = { ty: "fl", nm: "Fill", c: prop(chans.fill, STATIC_DEFAULTS.fill, fr, (v) => arr(v)), o: { a: 0, k: 100 }, r: 1 };
    const ks: J = {
      a: prop(chans.anchor, STATIC_DEFAULTS.anchor, fr),
      p: prop(chans.position, STATIC_DEFAULTS.position, fr),
      s: prop(chans.scale, STATIC_DEFAULTS.scale, fr),
      r: prop(chans.rotation, STATIC_DEFAULTS.rotation, fr),
      o: prop(chans.opacity, STATIC_DEFAULTS.opacity, fr),
    };
    const isNull = layer.content.kind === "null";
    const L: J = isNull ? { ddd: 0, ind: ind.get(layer.id), ty: 3, nm: layer.name, sr: 1, ks, ao: 0, ip: r(layer.inPoint * fr), op: r(layer.outPoint * fr), st: 0, bm: 0 } : { ddd: 0, ind: ind.get(layer.id), ty: 4, nm: layer.name, sr: 1, ks, ao: 0, shapes: shapeFor(layer, fill), ip: r(layer.inPoint * fr), op: r(layer.outPoint * fr), st: 0, bm: 0 };
    let parentInd = layer.parent ? ind.get(layer.parent) : undefined;
    if (layer.transformOrder === "RTS") {
      // Orbit: a null parent at the orbit centre carries the rotation exactly.
      const c = layer.orbitCenter ?? [0, 0];
      const nul: J = { ddd: 0, ind: nextInd++, ty: 3, nm: `${layer.name} orbit`, sr: 1, ks: { a: { a: 0, k: c }, p: { a: 0, k: c }, s: { a: 0, k: [100, 100] }, r: ks.r, o: { a: 0, k: 100 } }, ao: 0, ip: L.ip, op: L.op, st: 0, bm: 0 };
      if (parentInd !== undefined) nul.parent = parentInd;
      parentInd = nul.ind;
      ks.r = { a: 0, k: 0 };
      out.push(nul);
    }
    if (parentInd !== undefined) L.parent = parentInd;
    out.push(L);
  }
  if (anim.background) {
    out.push({ ddd: 0, ind: nextInd++, ty: 4, nm: "Background", sr: 1, ks: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }, ao: 0, shapes: shapeFor({ content: { kind: "rect", width: anim.width, height: anim.height } } as Layer, { ty: "fl", c: { a: 0, k: anim.background }, o: { a: 0, k: 100 }, r: 1 }), ip: 0, op: r(anim.duration * fr), st: 0, bm: 0, __bg: true });
  }
  // Lottie lists the top layer first; the model lists the bottom layer first.
  const bg = out.filter((l) => l.__bg);
  const layers = [...out.filter((l) => !l.__bg)].reverse().concat(bg);
  for (const l of layers) delete l.__bg;
  const json = { v: "5.9.0", fr, ip: 0, op: r(anim.duration * fr), w: anim.width, h: anim.height, nm: anim.name, ddd: 0, assets: [], layers, meta: { g: "Motion Timeline Editor v1" } };
  for (const d of drivers) { const r = reports.find((p) => p.path === `${d.layer}.${d.property}`); if (r) Object.assign(r, { fidelity: "baked", reason: "driver baked to keyframes", bakedKeyframeCount: d.keyframes, maxError: d.maxError }); }
  return { json, analysis: { target: "lottie", properties: reports, warnings } };
}
