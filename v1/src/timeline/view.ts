/**
 * Timeline geometry, hit testing, snapping and selection (§10). Pure
 * functions over a view description, so they are unit-testable without a
 * canvas; timeline/canvas.ts draws and timeline/controller.ts handles input.
 */
import type { KeyRef } from "../model/edit.js";
import type { Animation, PropertyName } from "../model/types.js";

export interface Row {
  layerId: string;
  property?: PropertyName; // undefined = the layer's summary row
  y: number;
}

export interface TimelineView {
  width: number;
  height: number;
  headerHeight: number;
  rowHeight: number;
  labelWidth: number;
  pxPerSecond: number;
  scrollX: number; // seconds at the left edge of the track area
  scrollY: number; // px
  expanded: Set<string>; // layer ids showing property rows
}

export const HIT_RADIUS = 6;

export function rows(anim: Animation, view: TimelineView): Row[] {
  const out: Row[] = [];
  let y = view.headerHeight;
  // Top layer first, as in every timeline.
  for (const l of [...anim.layers].reverse()) {
    out.push({ layerId: l.id, y });
    y += view.rowHeight;
    if (view.expanded.has(l.id))
      for (const p of Object.keys(l.channels) as PropertyName[]) {
        out.push({ layerId: l.id, property: p, y });
        y += view.rowHeight;
      }
  }
  return out;
}

/** Only rows inside the viewport (vertical virtualization). */
export function visibleRows(anim: Animation, view: TimelineView): Row[] {
  return rows(anim, view).filter((r) => r.y - view.scrollY + view.rowHeight >= view.headerHeight && r.y - view.scrollY <= view.height);
}

export const timeToX = (t: number, v: TimelineView) => v.labelWidth + (t - v.scrollX) * v.pxPerSecond;
export const xToTime = (x: number, v: TimelineView) => (x - v.labelWidth) / v.pxPerSecond + v.scrollX;

/** Visible time range (horizontal virtualization). */
export function visibleTimeRange(v: TimelineView): [number, number] {
  return [v.scrollX, v.scrollX + (v.width - v.labelWidth) / v.pxPerSecond];
}

export function keysInRow(anim: Animation, row: Row): KeyRef[] {
  const l = anim.layers.find((x) => x.id === row.layerId);
  if (!l) return [];
  const props = row.property ? [row.property] : (Object.keys(l.channels) as PropertyName[]);
  return props.flatMap((p) => (l.channels[p]?.keyframes ?? []).map((_, index) => ({ layerId: l.id, property: p, index })));
}

export type HitTarget =
  | { kind: "keyframe"; ref: KeyRef; refs: KeyRef[] }
  | { kind: "layerBar"; layerId: string }
  | { kind: "playhead" }
  | { kind: "ruler"; time: number }
  | { kind: "label"; layerId: string; property?: PropertyName }
  | { kind: "scaleHandle"; edge: "start" | "end" }
  | { kind: "empty" };

export function hitTest(anim: Animation, view: TimelineView, x: number, y: number, playhead: number, selection: { start: number; end: number } | null): HitTarget {
  if (y < view.headerHeight) {
    if (Math.abs(x - timeToX(playhead, view)) < HIT_RADIUS) return { kind: "playhead" };
    return { kind: "ruler", time: xToTime(x, view) };
  }
  if (selection && selection.end > selection.start) {
    for (const edge of ["start", "end"] as const) {
      const ex = timeToX(selection[edge], view);
      if (Math.abs(x - ex) < 4 && y < view.headerHeight + 10) return { kind: "scaleHandle", edge };
    }
  }
  const row = visibleRows(anim, view).find((r) => y + view.scrollY >= r.y && y + view.scrollY < r.y + view.rowHeight);
  if (!row) return { kind: "empty" };
  if (x < view.labelWidth) return { kind: "label", layerId: row.layerId, ...(row.property ? { property: row.property } : {}) };
  const t = xToTime(x, view);
  const layer = anim.layers.find((l) => l.id === row.layerId)!;
  // Nearest keyframe within the hit radius; on a summary row, all keys at that time.
  let best: { ref: KeyRef; d: number } | null = null;
  for (const ref of keysInRow(anim, row)) {
    const k = layer.channels[ref.property]!.keyframes[ref.index]!;
    const d = Math.abs(k.time - t) * view.pxPerSecond;
    if (d < HIT_RADIUS && (!best || d < best.d)) best = { ref, d };
  }
  if (best) {
    const time = layer.channels[best.ref.property]!.keyframes[best.ref.index]!.time;
    const refs = row.property ? [best.ref] : keysInRow(anim, row).filter((r) => Math.abs(layer.channels[r.property]!.keyframes[r.index]!.time - time) < 1e-9);
    return { kind: "keyframe", ref: best.ref, refs };
  }
  return { kind: "layerBar", layerId: row.layerId };
}

export interface SnapResult { time: number; target?: { time: number; kind: "frame" | "keyframe" | "playhead" | "inout" | "marker" } }

/** Snap (§10.2) to frames, other keyframes, the playhead, in/out points and markers. */
export function snap(anim: Animation, time: number, view: TimelineView, ctx: { playhead: number; exclude: Set<string>; markers?: number[]; disabled?: boolean }): SnapResult {
  if (ctx.disabled) return { time };
  const thresh = 8 / view.pxPerSecond;
  const candidates: Array<{ time: number; kind: NonNullable<SnapResult["target"]>["kind"]; prio: number }> = [{ time: ctx.playhead, kind: "playhead", prio: 0 }];
  for (const m of ctx.markers ?? []) candidates.push({ time: m, kind: "marker", prio: 0 });
  for (const l of anim.layers) {
    candidates.push({ time: l.inPoint, kind: "inout", prio: 1 }, { time: l.outPoint, kind: "inout", prio: 1 });
    for (const [p, ch] of Object.entries(l.channels)) ch!.keyframes.forEach((k, i) => { if (!ctx.exclude.has(`${l.id}/${p}/${i}`)) candidates.push({ time: k.time, kind: "keyframe", prio: 1 }); });
  }
  let best: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const d = Math.abs(c.time - time);
    if (d <= thresh && (!best || d < Math.abs(best.time - time) - 1e-12 || (Math.abs(d - Math.abs(best.time - time)) < 1e-12 && c.prio < best.prio))) best = c;
  }
  if (best) return { time: best.time, target: { time: best.time, kind: best.kind } };
  const frame = Math.round(time * anim.frameRate) / anim.frameRate;
  return { time: frame, target: { time: frame, kind: "frame" } };
}

/** Marquee selection. */
export function keysInRect(anim: Animation, view: TimelineView, x0: number, y0: number, x1: number, y1: number): KeyRef[] {
  const [ta, tb] = [xToTime(Math.min(x0, x1), view), xToTime(Math.max(x0, x1), view)];
  const [ya, yb] = [Math.min(y0, y1) + view.scrollY, Math.max(y0, y1) + view.scrollY];
  const out = new Map<string, KeyRef>();
  for (const row of rows(anim, view)) {
    if (row.y + view.rowHeight <= ya || row.y >= yb) continue;
    const layer = anim.layers.find((l) => l.id === row.layerId)!;
    for (const r of keysInRow(anim, row)) {
      const t = layer.channels[r.property]!.keyframes[r.index]!.time;
      if (t >= ta && t <= tb) out.set(`${r.layerId}/${r.property}/${r.index}`, r);
    }
  }
  return [...out.values()];
}
