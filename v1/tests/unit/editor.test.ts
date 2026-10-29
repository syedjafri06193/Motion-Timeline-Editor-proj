import { describe, expect, test } from "vitest";
import { clampHandle, graphHandles, handleFromGraph, setHandleDim } from "../../src/curves/handles.js";
import { bounceAndSpin, manyLayers } from "../../src/fixtures.js";
import { History } from "../../src/history/history.js";
import { importSvg } from "../../src/import/svg.js";
import { parsePath, toPathData } from "../../src/import/svgpath.js";
import { getKey, moveKeys, reverseKeys, scaleKeys, type KeyRef } from "../../src/model/edit.js";
import { evaluateChannel } from "../../src/model/evaluate.js";
import { addKeyAt, copyKeys, joinRevolutions, pasteKeys, splitRevolutions, toggleHold } from "../../src/model/keys.js";
import { keyframe, type Animation } from "../../src/model/types.js";
import { skinTimes, DEFAULT_ONION } from "../../src/render/onion.js";
import { motionPathPoints } from "../../src/render/motionPath.js";
import { TimelineController } from "../../src/timeline/controller.js";
import { hitTest, keysInRect, rows, snap, timeToX, visibleRows, type TimelineView } from "../../src/timeline/view.js";

const view = (): TimelineView => ({ width: 900, height: 300, headerHeight: 24, rowHeight: 20, labelWidth: 150, pxPerSecond: 200, scrollX: 0, scrollY: 0, expanded: new Set(["ball"]) });

describe("undo with coalescing (§10.4)", () => {
  test("a drag of many moves is one undo step; a zero-pixel drag is none", () => {
    const h = new History<number>(0, (a, b) => a === b);
    h.begin("drag");
    for (let i = 1; i <= 50; i++) h.update(i);
    h.commit();
    expect(h.size).toBe(1);
    h.begin("click"); h.update(50); h.commit();
    expect(h.size).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(50);
  });
  test("a new change clears redo", () => {
    const h = new History(1, (a, b) => a === b);
    h.apply("a", 2); h.undo(); h.apply("b", 3);
    expect(h.canRedo).toBe(false);
  });
});

describe("timeline (§10)", () => {
  const anim = bounceAndSpin();
  test("rows list the top layer first; expanded layers show property rows", () => {
    const r = rows(anim, view());
    expect(r[0]!.layerId).toBe("moon");
    expect(r.filter((x) => x.layerId === "ball" && x.property).length).toBe(4);
  });
  test("vertical virtualization draws only rows in view", () => {
    const big = manyLayers(50);
    const v = { ...view(), expanded: new Set<string>() };
    expect(visibleRows(big, v).length).toBeLessThanOrEqual(Math.ceil((v.height - v.headerHeight) / v.rowHeight) + 1);
  });
  test("hit testing finds the keyframe under the cursor", () => {
    const v = view();
    const row = rows(anim, v).find((r) => r.layerId === "ball" && r.property === "position")!;
    const hit = hitTest(anim, v, timeToX(1.2, v) + 2, row.y + 5, 0, null);
    expect(hit.kind).toBe("keyframe");
    if (hit.kind === "keyframe") expect(hit.ref).toEqual({ layerId: "ball", property: "position", index: 1 });
  });
  test("snapping prefers other keyframes and the playhead, else frames (§10.2)", () => {
    const v = view();
    expect(snap(anim, 1.21, v, { playhead: 0, exclude: new Set() }).target?.kind).toBe("keyframe");
    expect(snap(anim, 0.505, v, { playhead: 0.5, exclude: new Set() }).target?.kind).toBe("playhead");
    const f = snap(anim, 0.6571, v, { playhead: 0, exclude: new Set() });
    expect(f.target?.kind).toBe("frame");
    expect(f.time * 60).toBeCloseTo(Math.round(f.time * 60), 9);
  });
  test("marquee selects keys inside the rectangle", () => {
    const v = view();
    const row = rows(anim, v).find((r) => r.layerId === "ball" && r.property === "scale")!;
    const sel = keysInRect(anim, v, timeToX(1.05, v), row.y, timeToX(1.45, v), row.y + 10);
    expect(sel.length).toBe(3);
  });
  test("a whole keyframe drag through the controller is exactly one undo step", () => {
    const h = new History<Animation>(anim, (a, b) => a === b);
    const v = view();
    const c = new TimelineController(h, v, { selection: [], playhead: 0 }, () => {});
    const row = rows(anim, v).find((r) => r.layerId === "ball" && r.property === "position")!;
    c.down(timeToX(1.2, v), row.y + 5, { shift: false, alt: false });
    for (let i = 1; i <= 30; i++) c.move(timeToX(1.2, v) + i * 3, row.y + 5, { shift: false, alt: false, mod: false });
    c.up();
    expect(h.size).toBe(1);
    expect(getKey(h.current, c.state.selection[0]!)!.time).toBeGreaterThan(1.6);
  });
});

describe("keyframe operations (§10.3)", () => {
  const anim = bounceAndSpin();
  const refs: KeyRef[] = [0, 1, 2].map((index) => ({ layerId: "ball", property: "scale", index }));
  test("time scaling retimes proportionally about a pivot", () => {
    const r = scaleKeys(anim, refs, 1.1, 2);
    expect(r.refs.map((x) => +getKey(r.anim, x)!.time.toFixed(6))).toEqual([1.1, 1.3, 1.7]);
  });
  test("moving keeps order and returns updated refs", () => {
    const r = moveKeys(anim, [refs[0]!], 0.5);
    expect(getKey(r.anim, r.refs[0]!)!.time).toBeCloseTo(1.6, 9);
    const times = r.anim.layers.find((l) => l.id === "ball")!.channels.scale!.keyframes.map((k) => k.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
  test("reversing plays the motion backwards", () => {
    const pos: KeyRef[] = [0, 1, 2].map((index) => ({ layerId: "ball", property: "position", index }));
    const r = reverseKeys(anim, pos);
    const a = anim.layers.find((l) => l.id === "ball")!.channels.position!, b = r.anim.layers.find((l) => l.id === "ball")!.channels.position!;
    expect(evaluateChannel(b, 0)).toEqual(evaluateChannel(a, 2.2));
    expect(evaluateChannel(b, 2.2)).toEqual(evaluateChannel(a, 0));
  });
  test("hold toggle, add key at playhead, copy/paste", () => {
    expect(getKey(toggleHold(anim, [refs[0]!]), refs[0]!)!.hold).toBe(true);
    const added = addKeyAt(anim, "star", "rotation", 1.5);
    const rot = added.layers.find((l) => l.id === "star")!.channels.rotation!;
    expect(rot.keyframes.length).toBe(3);
    expect(rot.keyframes[1]!.value).toBeCloseTo(evaluateChannel(anim.layers.find((l) => l.id === "star")!.channels.rotation!, 1.5) as number, 9);
    const pasted = pasteKeys(anim, copyKeys(anim, refs), 2);
    expect(pasted.layers.find((l) => l.id === "ball")!.channels.scale!.keyframes.length).toBe(6);
  });
  test("revolutions + degrees (§6.2)", () => {
    expect(splitRevolutions(765)).toEqual({ revolutions: 2, degrees: 45 });
    expect(joinRevolutions(-1, -90)).toBe(-450);
  });
});

describe("curve editor maths (§11)", () => {
  test("x is clamped to [0,1] only when CSS is a target; y never is", () => {
    expect(clampHandle({ x: 1.3, y: 2 }, "css")).toEqual({ x: 1, y: 2, clamped: true });
    expect(clampHandle({ x: 1.3, y: 2 }, "lottie")).toEqual({ x: 1.3, y: 2, clamped: false });
  });
  test("value-graph handles round-trip to bezier coordinates", () => {
    const a = keyframe(1, [10, 20], { easeOut: { x: [0.3, 0.1], y: [0.2, 0.4] } }), b = keyframe(3, [50, 0], { easeIn: { x: [0.7, 0.8], y: [0.9, 1] } });
    for (const d of [0, 1]) {
      const h = graphHandles(a, b, d);
      expect(handleFromGraph(a, b, d, h.out).x).toBeCloseTo(a.easeOut.x[d]!, 9);
      expect(handleFromGraph(a, b, d, h.in).y).toBeCloseTo(b.easeIn.y[d]!, 9);
    }
  });
  test("editing one dimension makes a handle per-dimension; agreeing dimensions collapse back", () => {
    const h = setHandleDim({ x: [0.3], y: [0] }, 1, 2, { x: 0.5, y: 0 });
    expect(h.x).toEqual([0.3, 0.5]);
    expect(setHandleDim(h, 1, 2, { x: 0.3, y: 0 })).toEqual({ x: [0.3], y: [0] });
  });
});

describe("onion skin and motion path (§7)", () => {
  const anim = bounceAndSpin();
  test("frame mode: n before and after, falling alpha, clipped to the timeline", () => {
    const s = skinTimes(anim, 1, DEFAULT_ONION);
    expect(s.past.length).toBe(3);
    expect(s.past[0]!.alpha).toBeGreaterThan(s.past[2]!.alpha);
    expect(skinTimes(anim, 0, DEFAULT_ONION).past.length).toBe(0);
  });
  test("keyframe mode steps to neighbouring keyframes", () => {
    const s = skinTimes(anim, 1.25, { ...DEFAULT_ONION, mode: "keyframes" });
    expect(s.past[0]!.t).toBe(1.2);
    expect(s.future[0]!.t).toBe(1.3);
  });
  test("motion path has one point per frame", () => {
    expect(motionPathPoints(anim, anim.layers.find((l) => l.id === "ball")!).length).toBe(181);
  });
});

describe("SVG import (M7)", () => {
  test("path parsing covers relative, smooth, quadratic and arc commands", () => {
    const subs = parsePath("m10 10 h20 v20 q 10 10 20 0 t 20 0 s 10 10 20 0 a 10 10 0 0 1 20 0 z");
    expect(subs.length).toBe(1);
    expect(subs[0]!.closed).toBe(true);
    expect(parsePath(toPathData(subs))[0]!.segments.length).toBe(subs[0]!.segments.length);
  });
  test("each shape becomes a layer positioned where it was drawn", () => {
    const { animation, skipped } = importSvg(`<svg viewBox="0 0 200 100" width="200" height="100"><rect id="box" x="10" y="20" width="40" height="30" fill="#ff0000"/><g transform="translate(100 0)"><circle cx="20" cy="50" r="10" fill="blue"/></g><text>hi</text></svg>`);
    expect(animation.layers.length).toBe(2);
    expect((animation.layers[0]!.channels.position!.keyframes[0]!.value as number[]).map((v) => +v.toFixed(6))).toEqual([30, 35]);
    expect((animation.layers[1]!.channels.position!.keyframes[0]!.value as number[])[0]).toBeCloseTo(120, 3);
    expect(skipped).toContain("text");
  });
});
