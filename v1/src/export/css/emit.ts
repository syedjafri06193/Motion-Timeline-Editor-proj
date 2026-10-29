/**
 * CSS export (§9). Each layer becomes nested elements so every model feature
 * maps to an independent CSS property:
 *
 *   .L-orbit    rotate about the orbit centre (RTS order only, §9.2)
 *    .L-motion  offset-path motion (offset-path option only, §9.4/§17)
 *     .L        translate / rotate / scale, with left/top/transform-origin = anchor
 *      .L-content  opacity, fill and the shape (opacity doesn't inherit into children, as in Lottie)
 *      …children (parented layers)
 *
 * Box geometry: the element sits at (−anchor) with transform-origin at the
 * anchor, so its world transform is T(p)·R·S·T(−a) — Lottie's exactly.
 */
import { colorToCss } from "../../model/color.js";
import { animatedProperties, isPerDimension } from "../../model/evaluate.js";
import { arcTable, isCurved, type Vec2 } from "../../model/spatial.js";
import type { Animation, Channel, Color, Keyframe, Layer, PropertyName, Value } from "../../model/types.js";
import { STATIC_DEFAULTS } from "../../model/types.js";
import { expandChannel } from "../expand.js";
import { worst, type ExportAnalysis, type PropertyReport, type Support } from "../matrix.js";
import { cssEasing } from "./easing.js";
import { bakeDrivers } from "../../model/drivers.js";

export interface CssOptions {
  /** Use offset-path for curved motion instead of baking (exact; stretch goal §17). */
  offsetPath?: boolean;
  /** Spatial bake tolerance in px. */
  tolerancePx?: number;
  iterations?: number | "infinite";
  /** Class prefix so several exports can share a page. */
  prefix?: string;
}

export interface CssExport {
  css: string;
  html: string;
  /** A complete standalone page. */
  document: string;
  analysis: ExportAnalysis;
}

const f = (n: number) => +n.toFixed(4);
const px = (n: number) => `${f(n)}px`;
const vec = (v: Value) => (typeof v === "number" ? [v] : v);

function cssValue(prop: PropertyName, v: Value): string {
  const a = vec(v);
  switch (prop) {
    case "position": return `${px(a[0]!)} ${px(a[1]!)}`;
    case "scale": return `${f(a[0]! / 100)} ${f(a[1]! / 100)}`;
    case "rotation": return `${f(a[0]!)}deg`;
    case "opacity": return `${f(a[0]! / 100)}`;
    case "fill": return colorToCss(v as Color);
    case "anchor": return `${px(a[0]!)} ${px(a[1]!)}`;
  }
}

function declarations(prop: PropertyName, v: Value, fillProp: string): string {
  const a = vec(v);
  switch (prop) {
    case "position": return `translate: ${cssValue(prop, v)};`;
    case "scale": return `scale: ${cssValue(prop, v)};`;
    case "rotation": return `rotate: ${cssValue(prop, v)};`;
    case "opacity": return `opacity: ${cssValue(prop, v)};`;
    case "fill": return `${fillProp}: ${cssValue(prop, v)};`;
    case "anchor": return `left: ${px(-a[0]!)}; top: ${px(-a[1]!)}; transform-origin: ${cssValue(prop, v)};`;
  }
}

function needsBakeFor(ch: Channel, opts: CssOptions) {
  return (a: Keyframe, b: Keyframe) => {
    if (a.hold || a.easeFn) return ch.type === "color" && ch.colorSpace !== "srgb" && JSON.stringify(a.value) !== JSON.stringify(b.value) && !a.hold;
    if (ch.type === "color") return ch.colorSpace !== "srgb" && JSON.stringify(a.value) !== JSON.stringify(b.value);
    if (ch.type === "vector2" && isPerDimension(a, b)) return true;
    if (ch.spatial && !opts.offsetPath && isCurved(a.spatialOut, b.spatialIn)) return true;
    return false;
  };
}

interface Block { name: string; frames: string[] }

function keyframesBlock(name: string, kfs: Keyframe[], duration: number, decl: (v: Value) => string): { block: Block; clamped: boolean; linearFns: number; maxEaseError: number } {
  const frames: string[] = [];
  let clamped = false, linearFns = 0, maxEaseError = 0;
  const pct = (t: number) => `${+((t / duration) * 100).toFixed(4)}%`;
  if (kfs[0]!.time > 0) frames.push(`0% { ${decl(kfs[0]!.value)} animation-timing-function: linear; }`);
  kfs.forEach((k, i) => {
    const next = kfs[i + 1];
    let tf = "";
    if (next) {
      const e = cssEasing(k, next);
      clamped ||= e.clamped;
      if (e.kind === "linear()") { linearFns++; maxEaseError = Math.max(maxEaseError, e.maxError); }
      tf = ` animation-timing-function: ${e.css};`;
    }
    frames.push(`${pct(k.time)} { ${decl(k.value)}${tf} }`);
  });
  if (kfs[kfs.length - 1]!.time < duration) frames.push(`100% { ${decl(kfs[kfs.length - 1]!.value)} }`);
  return { block: { name, frames }, clamped, linearFns, maxEaseError };
}

/** offset-path through every keyframe, with offset-distance at each keyframe's cumulative arc length. */
function offsetPathFor(ch: Channel): { path: string; distances: number[] } {
  const kfs = ch.keyframes;
  let d = `M ${f((kfs[0]!.value as number[])[0]!)} ${f((kfs[0]!.value as number[])[1]!)}`;
  const lengths = [0];
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!, b = kfs[i + 1]!;
    const p0 = a.value as Vec2, p3 = b.value as Vec2;
    const c1: Vec2 = [p0[0] + (a.spatialOut?.[0] ?? 0), p0[1] + (a.spatialOut?.[1] ?? 0)];
    const c2: Vec2 = [p3[0] + (b.spatialIn?.[0] ?? 0), p3[1] + (b.spatialIn?.[1] ?? 0)];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p3[0])} ${f(p3[1])}`;
    lengths.push(lengths[i]! + arcTable(p0, c1, c2, p3).total);
  }
  const total = lengths[lengths.length - 1]! || 1;
  return { path: d, distances: lengths.map((l) => (l / total) * 100) };
}

function contentMarkup(layer: Layer, cls: string): { html: string; fillProp: string } {
  const c = layer.content;
  if (c.kind === "null") return { html: "", fillProp: "background-color" };
  if (c.kind === "path") return { html: `<svg class="${cls}" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" overflow="visible"><path d="${c.d}"/></svg>`, fillProp: "fill" };
  return { html: `<div class="${cls}"></div>`, fillProp: "background-color" };
}

export function exportCss(input: Animation, opts: CssOptions = {}): CssExport {
  const { anim, baked: drivers } = bakeDrivers(input);
  const prefix = opts.prefix ?? "mte";
  const D = anim.duration;
  const iter = opts.iterations ?? 1;
  const reports: PropertyReport[] = [];
  const warnings: string[] = [];
  const rules: string[] = [];
  const blocks: Block[] = [];
  const cls = (l: Layer, part = "") => `${prefix}-${l.id.replace(/[^a-zA-Z0-9_-]/g, "_")}${part}`;

  const children = new Map<string | undefined, Layer[]>();
  for (const l of anim.layers) children.set(l.parent, [...(children.get(l.parent) ?? []), l]);

  function layerMarkup(layer: Layer): string {
    const animations: Record<string, string[]> = { orbit: [], motion: [], main: [], content: [] };
    const statics: Record<string, string[]> = { orbit: [], motion: [], main: [], content: [] };
    const c = layer.content;
    const { html: contentHtml, fillProp } = contentMarkup(layer, cls(layer, "-content"));
    const animated = animatedProperties(layer);
    const rts = layer.transformOrder === "RTS";

    for (const prop of ["anchor", "position", "scale", "rotation", "opacity", "fill"] as PropertyName[]) {
      const ch = layer.channels[prop];
      const target = prop === "opacity" || prop === "fill" ? "content" : prop === "rotation" && rts ? "orbit" : "main";
      if (!ch || ch.keyframes.length === 0 || !animated.includes(prop)) {
        const v = ch?.keyframes[0]?.value ?? STATIC_DEFAULTS[prop];
        statics[target]!.push(declarations(prop, v, fillProp));
        continue;
      }
      const path = `${layer.name}.${prop}`;
      const curved = ch.spatial && ch.keyframes.some((k, i) => i < ch.keyframes.length - 1 && isCurved(k.spatialOut, ch.keyframes[i + 1]!.spatialIn));
      const perDim = ch.keyframes.some((k, i) => i < ch.keyframes.length - 1 && isPerDimension(k, ch.keyframes[i + 1]!));

      if (prop === "position" && curved && opts.offsetPath && !perDim) {
        // Exact curved motion: offset-path on a wrapper (its own transform order can't disturb R/S).
        const { path: d, distances } = offsetPathFor(ch);
        const kfs = ch.keyframes.map((k, i) => ({ ...k, value: distances[i]! }));
        const name = cls(layer, "-offset");
        const kb = keyframesBlock(name, kfs, D, (v) => `offset-distance: ${f(v as number)}%;`);
        blocks.push(kb.block);
        animations.motion!.push(name);
        statics.motion!.push(`offset-path: path("${d}"); offset-rotate: 0deg; offset-anchor: 0 0; offset-position: 0 0;`);
        reports.push({ path, fidelity: kb.clamped ? "unrepresentable" : kb.linearFns ? "approximated" : "exact", reason: "curved motion via offset-path" });
        continue;
      }

      const tol = ch.type === "color" ? 1 : prop === "position" ? opts.tolerancePx ?? 0.25 : 0.25;
      const e = expandChannel(ch, needsBakeFor(ch, opts), tol);
      const name = cls(layer, `-${prop}`);
      const kb = keyframesBlock(name, e.keyframes, D, (v) => declarations(prop, v, fillProp));
      blocks.push(kb.block);
      animations[target]!.push(name);
      let fidelity: Support = "exact";
      const reasons: string[] = [];
      if (e.bakedSegments) {
        fidelity = "baked";
        reasons.push(ch.type === "color" ? "OKLab interpolation baked for sRGB" : curved ? "curved motion path baked" : perDim ? "per-dimension easing (X ≠ Y) baked" : "baked");
      }
      if (kb.linearFns) { fidelity = worst(fidelity, "approximated"); reasons.push(`${kb.linearFns} easing function(s) as linear(), max error ${kb.maxEaseError.toFixed(4)}`); }
      if (kb.clamped) { fidelity = "unrepresentable"; reasons.push("handle x outside [0, 1] clamped (cubic-bezier requires monotonic time)"); }
      reports.push({ path, fidelity, ...(reasons.length ? { reason: reasons.join("; ") } : {}), ...(e.bakedSegments ? { bakedKeyframeCount: e.addedKeyframes, maxError: e.maxError } : {}) });
      if (kb.clamped) warnings.push(`${path}: easing handle x outside [0, 1] cannot be expressed in CSS; clamped`);
    }

    const anchorStatic = !animated.includes("anchor");
    if (anchorStatic && !statics.main!.some((s) => s.startsWith("left"))) statics.main!.push(declarations("anchor", STATIC_DEFAULTS.anchor, fillProp));
    const anim = (names: string[]) => (names.length ? ` animation: ${names.map((n) => `${n} ${f(D)}s both ${iter}`).join(", ")};` : "");
    const show = (layer.inPoint > 0 || layer.outPoint < D) ? (() => {
      const name = cls(layer, "-visible");
      const frames = [`0% { visibility: ${layer.inPoint > 0 ? "hidden" : "visible"}; animation-timing-function: steps(1, end); }`];
      if (layer.inPoint > 0) frames.push(`${+((layer.inPoint / D) * 100).toFixed(4)}% { visibility: visible; animation-timing-function: steps(1, end); }`);
      if (layer.outPoint < D) frames.push(`${+((layer.outPoint / D) * 100).toFixed(4)}% { visibility: hidden; animation-timing-function: steps(1, end); }`);
      blocks.push({ name, frames });
      return name;
    })() : null;
    if (show) animations.content!.push(show);

    const shape = c.kind === "ellipse" ? " border-radius: 50%;" : c.kind === "rect" && c.radius ? ` border-radius: ${px(c.radius)};` : "";
    rules.push(`.${cls(layer)} { position: absolute; width: ${px(c.width)}; height: ${px(c.height)}; ${statics.main!.join(" ")}${anim(animations.main!)}${animations.main!.length ? ` will-change: ${[...new Set(animations.main!.map((n) => n.split("-").pop()!.replace("position", "translate").replace("rotation", "rotate").replace("anchor", "transform-origin")))].join(", ")};` : ""} }`);
    rules.push(`.${cls(layer, "-content")} { position: absolute; left: 0; top: 0; width: 100%; height: 100%;${shape} ${statics.content!.join(" ")}${anim(animations.content!)} }`);
    let inner = `<div class="${cls(layer)}" data-layer="${layer.id}">${contentHtml}${(children.get(layer.id) ?? []).map(layerMarkup).join("")}</div>`;
    if (animations.motion!.length) {
      rules.push(`.${cls(layer, "-motion")} { position: absolute; left: 0; top: 0; width: 0; height: 0; ${statics.motion!.join(" ")}${anim(animations.motion!)} }`);
      // Translate moves into the motion wrapper's path; the inner element keeps R/S/anchor.
      inner = `<div class="${cls(layer, "-motion")}">${inner}</div>`;
    }
    if (rts) {
      const o = layer.orbitCenter ?? [0, 0];
      rules.push(`.${cls(layer, "-orbit")} { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: ${px(o[0])} ${px(o[1])}; ${statics.orbit!.join(" ")}${anim(animations.orbit!)} }`);
      inner = `<div class="${cls(layer, "-orbit")}">${inner}</div>`;
    }
    return inner;
  }

  const body = (children.get(undefined) ?? []).map(layerMarkup).join("\n");
  const stage = `.${prefix}-stage { position: relative; overflow: hidden; width: ${px(anim.width)}; height: ${px(anim.height)};${anim.background ? ` background: ${colorToCss(anim.background)};` : ""} }`;
  const css = [stage, ...rules, ...blocks.map((b) => `@keyframes ${b.name} {\n  ${b.frames.join("\n  ")}\n}`)].join("\n");
  const html = `<div class="${prefix}-stage">\n${body}\n</div>`;
  const document = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${anim.name}</title><style>\nhtml,body{margin:0}\n${css}\n</style></head><body>\n${html}\n</body></html>\n`;
  if (opts.offsetPath) warnings.push("offset-path mode: curved position channels move along a path wrapper; edit them as motion paths, not translate values");
  for (const d of drivers) { const r = reports.find((p) => p.path === `${d.layer}.${d.property}`); if (r) Object.assign(r, { fidelity: "baked", reason: "driver baked to keyframes", bakedKeyframeCount: d.keyframes, maxError: d.maxError }); }
  return { css, html, document, analysis: { target: "css", properties: reports, warnings } };
}
