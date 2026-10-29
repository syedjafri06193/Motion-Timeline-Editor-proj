/**
 * Segment easing editor (§11.1–11.4): drag P1 and P2 of one segment's
 * cubic-bezier. When CSS is a target the legal x band is drawn and handles
 * resist leaving it (§11.2). A dot replays the easing on loop (§11.4).
 */
import { easeAt } from "../easing/bezier.js";
import { EASING_FUNCTIONS, type EasingFunctionName } from "../easing/presets.js";
import { clampHandle, type ExportTarget } from "./handles.js";

export interface SegmentCurve { x1: number; y1: number; x2: number; y2: number; fn?: EasingFunctionName }

export class SegmentEditor {
  curve: SegmentCurve = { x1: 0.333, y1: 0, x2: 0.667, y2: 1 };
  target: ExportTarget = "both";
  private dragging: 1 | 2 | null = null;
  private start = performance.now();
  hint = "";
  onInput: (c: SegmentCurve, final: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", () => { if (this.dragging) { this.dragging = null; this.onInput(this.curve, true); } });
  }

  private map() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, pad = 24;
    const sx = (x: number) => pad + x * (w - 2 * pad - 36);
    const sy = (y: number) => h - pad - ((y + 0.5) / 2) * (h - 2 * pad);
    const ix = (px: number) => (px - pad) / (w - 2 * pad - 36);
    const iy = (py: number) => ((h - pad - py) / (h - 2 * pad)) * 2 - 0.5;
    return { sx, sy, ix, iy, w, h, pad };
  }

  private down(e: PointerEvent) {
    if (this.curve.fn) return;
    const m = this.map(), r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const d1 = Math.hypot(x - m.sx(this.curve.x1), y - m.sy(this.curve.y1)), d2 = Math.hypot(x - m.sx(this.curve.x2), y - m.sy(this.curve.y2));
    if (Math.min(d1, d2) < 14) { this.dragging = d1 <= d2 ? 1 : 2; this.canvas.setPointerCapture(e.pointerId); }
  }
  private move(e: PointerEvent) {
    if (!this.dragging) return;
    const m = this.map(), r = this.canvas.getBoundingClientRect();
    const h = clampHandle({ x: m.ix(e.clientX - r.left), y: m.iy(e.clientY - r.top) }, this.target);
    this.hint = h.clamped ? "CSS needs x in [0, 1]: time can't run backwards in cubic-bezier()" : "";
    const v = { x: +h.x.toFixed(3), y: +h.y.toFixed(3) };
    this.curve = this.dragging === 1 ? { ...this.curve, x1: v.x, y1: v.y } : { ...this.curve, x2: v.x, y2: v.y };
    this.onInput(this.curve, false);
  }

  at(x: number): number {
    return this.curve.fn ? EASING_FUNCTIONS[this.curve.fn](x) : easeAt(x, this.curve.x1, this.curve.y1, this.curve.x2, this.curve.y2);
  }

  draw(theme: { bg: string; grid: string; line: string; accent: string; muted: string; warn: string }): void {
    const dpr = devicePixelRatio || 1, c = this.canvas;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = this.map();
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, m.w, m.h);
    if (this.target !== "lottie") { ctx.fillStyle = theme.grid; ctx.globalAlpha = 0.35; ctx.fillRect(m.sx(0), 0, m.sx(1) - m.sx(0), m.h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
    ctx.strokeRect(m.sx(0), m.sy(1), m.sx(1) - m.sx(0), m.sy(0) - m.sy(1));
    ctx.strokeStyle = theme.line; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 200; i++) { const x = i / 200, px = m.sx(x), py = m.sy(this.at(x)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    if (!this.curve.fn) {
      ctx.strokeStyle = theme.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.sx(0), m.sy(0)); ctx.lineTo(m.sx(this.curve.x1), m.sy(this.curve.y1)); ctx.moveTo(m.sx(1), m.sy(1)); ctx.lineTo(m.sx(this.curve.x2), m.sy(this.curve.y2)); ctx.stroke();
      for (const [x, y] of [[this.curve.x1, this.curve.y1], [this.curve.x2, this.curve.y2]] as const) { ctx.fillStyle = theme.accent; ctx.beginPath(); ctx.arc(m.sx(x), m.sy(y), 6, 0, Math.PI * 2); ctx.fill(); }
    }
    // Replay dot (§11.4): 1 s of motion, 0.4 s pause.
    const p = ((performance.now() - this.start) / 1400) % 1, x = Math.min(1, p / (1 / 1.4));
    const y = this.at(x);
    ctx.fillStyle = theme.accent; ctx.beginPath(); ctx.arc(m.w - 14, m.sy(y), 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(m.w - 14, m.sy(0)); ctx.lineTo(m.w - 14, m.sy(1)); ctx.stroke();
    if (this.hint) { ctx.fillStyle = theme.warn; ctx.font = "11px system-ui"; ctx.fillText(this.hint, m.pad, 14); }
  }
}
