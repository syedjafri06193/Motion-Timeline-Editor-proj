/**
 * Value graph editor (§11.1, M8): every dimension of a layer's channels as
 * value over time, with keyframe points and tangent handles. Dragging a point
 * moves its time and value; dragging a handle edits that dimension's easing
 * (making it per-dimension, which the CSS analysis then reports).
 */
import { evaluateChannel } from "../model/evaluate.js";
import type { Animation, Channel, Keyframe, Layer, PropertyName } from "../model/types.js";
import { clampHandle, graphHandles, handleFromGraph, setHandleDim, type ExportTarget } from "./handles.js";

const expandTo = (h: { x: number[]; y: number[] }, n: number) => ({ x: Array.from({ length: n }, (_, i) => h.x[Math.min(i, h.x.length - 1)]!), y: Array.from({ length: n }, (_, i) => h.y[Math.min(i, h.y.length - 1)]!) });

const COLORS = ["#e5484d", "#30a46c", "#3e63dd", "#f5a524", "#8e4ec6", "#12a594"];

type Hit = { kind: "key"; prop: PropertyName; index: number; d: number } | { kind: "out" | "in"; prop: PropertyName; index: number; d: number };

export class ValueGraph {
  layer: Layer | null = null;
  visible = new Set<PropertyName>(["position", "rotation", "scale", "opacity"]);
  target: ExportTarget = "both";
  private drag: Hit | null = null;
  private range = { t0: 0, t1: 1, v0: 0, v1: 1 };
  onEdit: (layer: Layer, final: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private anim: () => Animation) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", () => { if (this.drag && this.layer) this.onEdit(this.layer, true); this.drag = null; });
  }

  private dims(ch: Channel) { const v = ch.keyframes[0]!.value; return typeof v === "number" ? 1 : ch.type === "color" ? 0 : v.length; }
  private val(k: Keyframe, d: number) { return typeof k.value === "number" ? k.value : k.value[d]!; }

  private channels(): Array<[PropertyName, Channel]> {
    if (!this.layer) return [];
    return (Object.entries(this.layer.channels) as Array<[PropertyName, Channel]>).filter(([p, ch]) => this.visible.has(p) && ch.keyframes.length > 1 && ch.type !== "color");
  }

  private fit() {
    const a = this.anim();
    let v0 = Infinity, v1 = -Infinity;
    for (const [, ch] of this.channels()) {
      const n = this.dims(ch);
      for (let s = 0; s <= 120; s++) {
        const v = evaluateChannel(ch, (s / 120) * a.duration);
        for (let d = 0; d < n; d++) { const x = typeof v === "number" ? v : v[d]!; v0 = Math.min(v0, x); v1 = Math.max(v1, x); }
      }
      for (let i = 0; i < ch.keyframes.length - 1; i++) for (let d = 0; d < n; d++) { const h = graphHandles(ch.keyframes[i]!, ch.keyframes[i + 1]!, d); v0 = Math.min(v0, h.out[1], h.in[1]); v1 = Math.max(v1, h.out[1], h.in[1]); }
    }
    if (!isFinite(v0)) { v0 = 0; v1 = 1; }
    const pad = (v1 - v0 || 1) * 0.1;
    if (!this.drag) this.range = { t0: 0, t1: a.duration, v0: v0 - pad, v1: v1 + pad };
  }

  private sx = (t: number) => 40 + ((t - this.range.t0) / (this.range.t1 - this.range.t0)) * (this.canvas.clientWidth - 56);
  private sy = (v: number) => this.canvas.clientHeight - 16 - ((v - this.range.v0) / (this.range.v1 - this.range.v0)) * (this.canvas.clientHeight - 32);
  private it = (x: number) => this.range.t0 + ((x - 40) / (this.canvas.clientWidth - 56)) * (this.range.t1 - this.range.t0);
  private iv = (y: number) => this.range.v0 + ((this.canvas.clientHeight - 16 - y) / (this.canvas.clientHeight - 32)) * (this.range.v1 - this.range.v0);

  private hit(x: number, y: number): Hit | null {
    let best: (Hit & { dist: number }) | null = null;
    for (const [p, ch] of this.channels()) {
      const n = this.dims(ch);
      ch.keyframes.forEach((k, i) => {
        for (let d = 0; d < n; d++) {
          const dist = Math.hypot(this.sx(k.time) - x, this.sy(this.val(k, d)) - y);
          if (dist < 8 && (!best || dist < best.dist)) best = { kind: "key", prop: p, index: i, d, dist };
          const next = ch.keyframes[i + 1];
          if (next && !k.hold && !k.easeFn) {
            const h = graphHandles(k, next, d);
            const dOut = Math.hypot(this.sx(h.out[0]) - x, this.sy(h.out[1]) - y), dIn = Math.hypot(this.sx(h.in[0]) - x, this.sy(h.in[1]) - y);
            if (dOut < 7 && (!best || dOut < best.dist)) best = { kind: "out", prop: p, index: i, d, dist: dOut };
            if (dIn < 7 && (!best || dIn < best.dist)) best = { kind: "in", prop: p, index: i, d, dist: dIn };
          }
        }
      });
    }
    return best;
  }

  private down(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.drag = this.hit(e.clientX - r.left, e.clientY - r.top);
    if (this.drag) this.canvas.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (!this.drag || !this.layer) return;
    const r = this.canvas.getBoundingClientRect();
    const t = this.it(e.clientX - r.left), v = this.iv(e.clientY - r.top);
    const { prop, index, d, kind } = this.drag;
    const ch = this.layer.channels[prop]!;
    const n = this.dims(ch);
    const kfs = ch.keyframes.map((k) => ({ ...k }));
    if (kind === "key") {
      const lo = kfs[index - 1]?.time ?? 0, hi = kfs[index + 1]?.time ?? this.anim().duration;
      const k = kfs[index]!;
      k.time = Math.min(hi - 1e-3, Math.max(lo + 1e-3, t));
      if (typeof k.value === "number") k.value = v; else { const arr = [...k.value]; arr[d] = v; k.value = arr; }
    } else {
      const a = kfs[index]!, b = kfs[index + 1]!;
      const h = clampHandle(handleFromGraph(a, b, d, [t, v]), this.target);
      if (kind === "out") a.easeOut = setHandleDim(a.easeOut, d, n, h); else b.easeIn = setHandleDim(b.easeIn, d, n, h);
      // Keep both handles of a segment the same shape (shared or per-dimension).
      if (a.easeOut.x.length !== b.easeIn.x.length) { a.easeOut = expandTo(a.easeOut, n); b.easeIn = expandTo(b.easeIn, n); }
    }
    this.layer = { ...this.layer, channels: { ...this.layer.channels, [prop]: { ...ch, keyframes: kfs } } };
    this.onEdit(this.layer, false);
  }

  draw(theme: { bg: string; grid: string; text: string; muted: string }): void {
    const dpr = devicePixelRatio || 1, c = this.canvas;
    if (c.width !== c.clientWidth * dpr || c.height !== c.clientHeight * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    this.fit();
    ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(this.sx(this.range.t0), this.sy(0)); ctx.lineTo(this.sx(this.range.t1), this.sy(0)); ctx.stroke();
    ctx.font = "11px system-ui"; ctx.fillStyle = theme.muted;
    ctx.fillText(`${+this.range.v1.toFixed(1)}`, 4, 14); ctx.fillText(`${+this.range.v0.toFixed(1)}`, 4, c.clientHeight - 6);
    let ci = 0;
    for (const [p, ch] of this.channels()) {
      const n = this.dims(ch);
      for (let d = 0; d < n; d++, ci++) {
        const color = COLORS[ci % COLORS.length]!;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
        const N = 300;
        for (let s = 0; s <= N; s++) { const t = this.range.t0 + ((this.range.t1 - this.range.t0) * s) / N; const v = evaluateChannel(ch, t); const y = this.sy(typeof v === "number" ? v : v[d]!); s ? ctx.lineTo(this.sx(t), y) : ctx.moveTo(this.sx(t), y); }
        ctx.stroke();
        ctx.fillStyle = color; ctx.fillText(`${p}${n > 1 ? ".xyz"[d + 1] : ""}`, this.sx(this.range.t1) - 70, 14 + ci * 13);
        ch.keyframes.forEach((k, i) => {
          const next = ch.keyframes[i + 1];
          if (next && !k.hold && !k.easeFn) {
            const h = graphHandles(k, next, d);
            ctx.strokeStyle = theme.muted; ctx.lineWidth = 1; ctx.beginPath();
            ctx.moveTo(this.sx(k.time), this.sy(this.val(k, d))); ctx.lineTo(this.sx(h.out[0]), this.sy(h.out[1]));
            ctx.moveTo(this.sx(next.time), this.sy(this.val(next, d))); ctx.lineTo(this.sx(h.in[0]), this.sy(h.in[1])); ctx.stroke();
            for (const q of [h.out, h.in]) { ctx.fillStyle = theme.bg; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(this.sx(q[0]), this.sy(q[1]), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          }
          ctx.fillStyle = color; ctx.fillRect(this.sx(k.time) - 3.5, this.sy(this.val(k, d)) - 3.5, 7, 7);
        });
      }
    }
    if (!this.channels().length) { ctx.fillStyle = theme.muted; ctx.fillText("Select a layer with animated numeric channels", 48, 24); }
  }
}
