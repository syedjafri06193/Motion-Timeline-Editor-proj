/**
 * Timeline interaction: click/shift-click/marquee selection, drag to move
 * (snapped, with the snap target shown), drag a selection edge to retime
 * proportionally, scrub on the ruler. Every drag is one coalesced undo step.
 */
import type { History } from "../history/history.js";
import { getKey, keyId, moveKeys, scaleKeys, type KeyRef } from "../model/edit.js";
import type { Animation } from "../model/types.js";
import { selectionRange } from "./canvas.js";
import { hitTest, keysInRect, snap, xToTime, type TimelineView } from "./view.js";

export interface TimelineState {
  selection: KeyRef[];
  playhead: number;
  snapLine?: number;
  marquee?: [number, number, number, number];
}

type Drag =
  | { kind: "move"; origin: Animation; refs: KeyRef[]; grabTime: number; anchorRef: KeyRef }
  | { kind: "scale"; origin: Animation; refs: KeyRef[]; edge: "start" | "end"; range: { start: number; end: number } }
  | { kind: "scrub" }
  | { kind: "marquee"; x0: number; y0: number; additive: KeyRef[] }
  | null;

export class TimelineController {
  private drag: Drag = null;
  constructor(private history: History<Animation>, public view: TimelineView, public state: TimelineState, private onChange: () => void) {}

  get anim(): Animation { return this.history.current; }

  down(x: number, y: number, mods: { shift: boolean; alt: boolean }): void {
    const sel = selectionRange(this.anim, this.state.selection);
    const hit = hitTest(this.anim, this.view, x, y, this.state.playhead, sel);
    switch (hit.kind) {
      case "playhead": case "ruler":
        this.drag = { kind: "scrub" };
        this.state.playhead = Math.max(0, Math.min(this.anim.duration, xToTime(x, this.view)));
        break;
      case "scaleHandle":
        this.history.begin("Scale keyframes in time");
        this.drag = { kind: "scale", origin: this.anim, refs: this.state.selection, edge: hit.edge, range: sel! };
        break;
      case "keyframe": {
        const ids = new Set(this.state.selection.map(keyId));
        if (mods.shift) {
          const all = hit.refs.every((r) => ids.has(keyId(r)));
          this.state.selection = all ? this.state.selection.filter((r) => !hit.refs.some((h) => keyId(h) === keyId(r))) : [...this.state.selection, ...hit.refs.filter((r) => !ids.has(keyId(r)))];
        } else if (!ids.has(keyId(hit.ref))) this.state.selection = hit.refs;
        this.history.begin(this.state.selection.length > 1 ? "Move keyframes" : "Move keyframe");
        this.drag = { kind: "move", origin: this.anim, refs: this.state.selection, grabTime: getKey(this.anim, hit.ref)!.time, anchorRef: hit.ref };
        break;
      }
      case "label":
        if (!hit.property) {
          if (this.view.expanded.has(hit.layerId)) this.view.expanded.delete(hit.layerId);
          else this.view.expanded.add(hit.layerId);
        }
        break;
      default:
        this.drag = { kind: "marquee", x0: x, y0: y, additive: mods.shift ? this.state.selection : [] };
        if (!mods.shift) this.state.selection = [];
    }
    this.onChange();
  }

  move(x: number, y: number, mods: { shift: boolean; alt: boolean; mod: boolean }): void {
    const d = this.drag;
    if (!d) return;
    const t = xToTime(x, this.view);
    if (d.kind === "scrub") this.state.playhead = Math.max(0, Math.min(this.anim.duration, t));
    else if (d.kind === "move") {
      const raw = d.grabTime + (t - d.grabTime);
      const s = snap(d.origin, raw, this.view, { playhead: this.state.playhead, exclude: new Set(d.refs.map(keyId)), disabled: mods.mod });
      this.state.snapLine = s.target && s.target.kind !== "frame" ? s.target.time : undefined;
      const r = moveKeys(d.origin, d.refs, s.time - d.grabTime);
      this.history.update(r.anim);
      this.state.selection = r.refs;
    } else if (d.kind === "scale") {
      const pivot = d.edge === "end" ? d.range.start : d.range.end;
      const moving = d.edge === "end" ? d.range.end : d.range.start;
      const s = snap(d.origin, t, this.view, { playhead: this.state.playhead, exclude: new Set(d.refs.map(keyId)), disabled: mods.mod });
      this.state.snapLine = s.target && s.target.kind !== "frame" ? s.target.time : undefined;
      const factor = (s.time - pivot) / (moving - pivot || 1);
      const r = scaleKeys(d.origin, d.refs, pivot, Math.max(0.01, factor));
      this.history.update(r.anim);
      this.state.selection = r.refs;
    } else if (d.kind === "marquee") {
      this.state.marquee = [d.x0, d.y0, x, y];
      const inside = keysInRect(this.anim, this.view, d.x0, d.y0, x, y);
      const ids = new Set(d.additive.map(keyId));
      this.state.selection = [...d.additive, ...inside.filter((r) => !ids.has(keyId(r)))];
    }
    this.onChange();
  }

  up(): void {
    if (this.drag?.kind === "move" || this.drag?.kind === "scale") this.history.commit();
    this.drag = null;
    this.state.snapLine = undefined;
    this.state.marquee = undefined;
    this.onChange();
  }

  selectLayer(layerId: string): void {
    const l = this.anim.layers.find((x) => x.id === layerId);
    if (!l) return;
    this.state.selection = Object.entries(l.channels).flatMap(([p, ch]) => ch!.keyframes.map((_, index) => ({ layerId, property: p as KeyRef["property"], index })));
    this.onChange();
  }
}
