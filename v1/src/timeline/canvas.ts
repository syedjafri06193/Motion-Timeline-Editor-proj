/** Timeline drawing (§10.1): canvas, only visible rows and keys. */
import { keyId, type KeyRef } from "../model/edit.js";
import type { Animation } from "../model/types.js";
import { keysInRow, timeToX, visibleRows, visibleTimeRange, type TimelineView } from "./view.js";

export interface TimelinePaint {
  playhead: number;
  selected: Set<string>;
  snapLine?: number;
  marquee?: [number, number, number, number];
  selectionRange?: { start: number; end: number } | null;
  theme: { bg: string; panel: string; grid: string; text: string; muted: string; key: string; keySel: string; accent: string; row: string };
}

export function drawTimeline(ctx: CanvasRenderingContext2D, anim: Animation, view: TimelineView, p: TimelinePaint): number {
  const { width: W, height: H } = view;
  const th = p.theme;
  let drawnKeys = 0;
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  // Ruler
  ctx.fillStyle = th.panel; ctx.fillRect(0, 0, W, view.headerHeight);
  const [t0, t1] = visibleTimeRange(view);
  const spacing = [1 / anim.frameRate, 0.1, 0.25, 0.5, 1, 2, 5, 10].find((s) => s * view.pxPerSecond >= 60) ?? 10;
  ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
  for (let t = Math.floor(t0 / spacing) * spacing; t <= Math.min(t1, anim.duration) + 1e-9; t += spacing) {
    if (t < 0) continue;
    const x = timeToX(t, view);
    if (x < view.labelWidth) continue;
    ctx.fillStyle = th.grid; ctx.fillRect(Math.round(x), view.headerHeight - 6, 1, 6);
    ctx.fillStyle = th.muted; ctx.fillText(`${+t.toFixed(2)}s`, x + 3, view.headerHeight / 2);
  }
  // Rows
  ctx.save();
  ctx.beginPath(); ctx.rect(0, view.headerHeight, W, H - view.headerHeight); ctx.clip();
  for (const row of visibleRows(anim, view)) {
    const y = row.y - view.scrollY;
    const layer = anim.layers.find((l) => l.id === row.layerId)!;
    ctx.fillStyle = row.property ? th.bg : th.row; ctx.fillRect(0, y, W, view.rowHeight);
    ctx.fillStyle = th.grid; ctx.fillRect(0, y + view.rowHeight - 1, W, 1);
    // Layer bar between in and out points
    if (!row.property) {
      const xa = Math.max(view.labelWidth, timeToX(layer.inPoint, view)), xb = Math.min(W, timeToX(layer.outPoint, view));
      ctx.fillStyle = th.grid; ctx.fillRect(xa, y + 4, Math.max(0, xb - xa), view.rowHeight - 9);
    }
    ctx.fillStyle = row.property ? th.muted : th.text;
    ctx.fillText(row.property ? `   ${row.property}` : `${view.expanded.has(layer.id) ? "▾" : "▸"} ${layer.name}`, 8, y + view.rowHeight / 2);
    const cy = y + view.rowHeight / 2;
    for (const ref of keysInRow(anim, row)) {
      const k = layer.channels[ref.property]!.keyframes[ref.index]!;
      if (k.time < t0 - 0.1 || k.time > t1 + 0.1) continue; // horizontal virtualization
      const x = timeToX(k.time, view);
      if (x < view.labelWidth) continue;
      const sel = p.selected.has(keyId(ref));
      ctx.fillStyle = sel ? th.keySel : th.key;
      ctx.beginPath();
      if (k.hold) ctx.rect(x - 4, cy - 4, 8, 8);
      else { ctx.moveTo(x, cy - 5); ctx.lineTo(x + 5, cy); ctx.lineTo(x, cy + 5); ctx.lineTo(x - 5, cy); ctx.closePath(); }
      ctx.fill();
      drawnKeys++;
    }
  }
  ctx.restore();
  // Label column divider
  ctx.fillStyle = th.grid; ctx.fillRect(view.labelWidth - 1, 0, 1, H);
  // Selection range with time-scale handles (§10.3)
  if (p.selectionRange && p.selectionRange.end > p.selectionRange.start) {
    const xa = timeToX(p.selectionRange.start, view), xb = timeToX(p.selectionRange.end, view);
    ctx.fillStyle = th.accent; ctx.globalAlpha = 0.25; ctx.fillRect(xa, view.headerHeight, xb - xa, 10); ctx.globalAlpha = 1;
    ctx.fillRect(xa - 1, view.headerHeight, 3, 10); ctx.fillRect(xb - 1, view.headerHeight, 3, 10);
  }
  if (p.snapLine !== undefined) { ctx.fillStyle = th.accent; ctx.globalAlpha = 0.6; ctx.fillRect(Math.round(timeToX(p.snapLine, view)), view.headerHeight, 1, H); ctx.globalAlpha = 1; }
  if (p.marquee) {
    const [a, b, c, d] = p.marquee;
    ctx.strokeStyle = th.accent; ctx.setLineDash([4, 3]); ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); ctx.setLineDash([]);
  }
  const px = timeToX(p.playhead, view);
  if (px >= view.labelWidth) { ctx.fillStyle = th.accent; ctx.fillRect(Math.round(px), 0, 2, H); }
  return drawnKeys;
}

export function selectionRange(anim: Animation, sel: KeyRef[]): { start: number; end: number } | null {
  if (sel.length < 2) return null;
  const ts = sel.map((r) => anim.layers.find((l) => l.id === r.layerId)!.channels[r.property]!.keyframes[r.index]!.time);
  return { start: Math.min(...ts), end: Math.max(...ts) };
}
