import { describe, expect, test } from "vitest";
import { exportCss } from "../../src/export/css/emit.js";
import { cssEasing } from "../../src/export/css/easing.js";
import { fromDotLottie, toDotLottie } from "../../src/export/dotlottie.js";
import { exportLottie } from "../../src/export/lottie/emit.js";
import { snapToFrames } from "../../src/export/lottie/quantize.js";
import { CAPABILITIES } from "../../src/export/matrix.js";
import { bake } from "../../src/export/bake.js";
import { bounceAndSpin } from "../../src/fixtures.js";
import { importLottie } from "../../src/import/lottie.js";
import { channel, keyframe, type Animation, type Layer } from "../../src/model/types.js";

const one = (layer: Partial<Layer> & Pick<Layer, "channels">): Animation => ({ name: "t", width: 200, height: 200, duration: 2, frameRate: 30, layers: [{ id: "a", name: "A", content: { kind: "rect", width: 10, height: 10 }, inPoint: 0, outPoint: 2, ...layer }] });
const report = (a: ReturnType<typeof exportCss>["analysis"], path: string) => a.properties.find((p) => p.path === path);

describe("capability matrix (§3)", () => {
  test("the three hard CSS losses are in the data, and every row has notes", () => {
    const css = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c.css]));
    expect(css["per-dimension-easing"]).toBe("baked");
    expect(css["spatial-path"]).toBe("baked");
    expect(css["non-monotonic-time"]).toBe("unrepresentable");
    for (const c of CAPABILITIES) expect(c.notes.length).toBeGreaterThan(10);
  });
});

describe("baking (§9.4)", () => {
  test("stays within the requested tolerance", () => {
    const f = (t: number) => [Math.sin(t * 6) * 100, Math.cos(t * 3) * 50];
    const r = bake(f, 0, 2, 0.25);
    expect(r.maxError).toBeLessThan(0.3);
    expect(r.times[0]).toBe(0);
    expect(r.times[r.times.length - 1]).toBe(2);
  });
});

describe("CSS export (§9)", () => {
  test("aligned, shared easing exports exactly — only report a loss when there is one", () => {
    const a = one({ channels: { position: channel("position", [keyframe(0, [0, 0]), keyframe(1, [100, 50])]), rotation: channel("rotation", [keyframe(0, 0), keyframe(2, 720)]) } });
    const out = exportCss(a);
    expect(out.analysis.properties.every((p) => p.fidelity === "exact")).toBe(true);
    expect(out.css).toMatch(/rotate: 720deg/);
    expect(out.css).toMatch(/animation-timing-function: cubic-bezier\(0\.333, 0, 0\.667, 1\)/);
  });
  test("per-dimension easing is baked and reported", () => {
    const a = one({ channels: { position: channel("position", [keyframe(0, [0, 0], { easeOut: { x: [0, 0.8], y: [0, 0] } }), keyframe(1, [100, 100], { easeIn: { x: [1, 0.2], y: [1, 1] } })]) } });
    const r = report(exportCss(a).analysis, "A.position")!;
    expect(r.fidelity).toBe("baked");
    expect(r.reason).toMatch(/per-dimension/);
    expect(r.bakedKeyframeCount).toBeGreaterThan(2);
    expect(r.maxError).toBeLessThanOrEqual(0.3);
  });
  test("curved motion is baked with a count and deviation, or exact via offset-path", () => {
    const a = one({ channels: { position: channel("position", [keyframe(0, [0, 0], { spatialOut: [0, -80] }), keyframe(1, [100, 0], { spatialIn: [0, -80] })]) } });
    const baked = report(exportCss(a).analysis, "A.position")!;
    expect(baked.fidelity).toBe("baked");
    expect(baked.reason).toMatch(/curved/);
    const off = exportCss(a, { offsetPath: true });
    expect(report(off.analysis, "A.position")!.fidelity).toBe("exact");
    expect(off.css).toMatch(/offset-path: path\("M 0 0 C 0 -80 100 -80 100 0"\)/);
  });
  test("bounce uses linear(); hold uses steps(1, end); handle x outside [0,1] is clamped and reported", () => {
    const a = one({ channels: {
      opacity: channel("opacity", [keyframe(0, 0, { easeFn: "bounce-out" }), keyframe(1, 100, { hold: true }), keyframe(1.5, 50)]),
      rotation: channel("rotation", [keyframe(0, 0, { easeOut: { x: [1.4], y: [0] } }), keyframe(1, 90)]),
    } });
    const out = exportCss(a);
    expect(out.css).toMatch(/animation-timing-function: linear\(0, /);
    expect(out.css).toMatch(/steps\(1, end\)/);
    expect(report(out.analysis, "A.opacity")!.fidelity).toBe("approximated");
    expect(report(out.analysis, "A.rotation")!.fidelity).toBe("unrepresentable");
    expect(out.analysis.warnings.join()).toMatch(/clamped/);
  });
  test("timing function sits on the keyframe that starts the segment", () => {
    expect(cssEasing(keyframe(0, 0, { easeOut: { x: [0.1], y: [0.2] } }), keyframe(1, 1, { easeIn: { x: [0.3], y: [0.4] } })).css).toBe("cubic-bezier(0.1, 0.2, 0.3, 0.4)");
  });
  test("RTS orbits use a wrapper element; colour is baked to stay within ΔE 1", () => {
    const out = exportCss(bounceAndSpin());
    expect(out.html).toMatch(/mte-moon-orbit/);
    const fill = report(out.analysis, "Ball.fill")!;
    expect(fill.fidelity).toBe("baked");
    expect(fill.maxError!).toBeLessThanOrEqual(1);
  });
});

describe("Lottie export (§8)", () => {
  const { json, analysis } = exportLottie(bounceAndSpin());
  const L = (nm: string) => json.layers.find((l: { nm: string }) => l.nm === nm);
  test("structure, static vs animated, units", () => {
    expect(json.fr).toBe(60);
    expect(json.op).toBe(180);
    expect(L("Ball").ks.a).toEqual({ a: 0, k: [40, 40] }); // one keyframe → static
    expect(L("Star").ks.r.a).toBe(1);
    expect(L("Star").ks.r.k.at(-1).s).toEqual([720]);
  });
  test("spatial tangents are offsets from the keyframe, on the segment's left keyframe", () => {
    const k0 = L("Ball").ks.p.k[0];
    expect(k0.to).toEqual([120, -320]);
    expect(k0.ti).toEqual([-120, -320]);
  });
  test("per-dimension easing is kept as arrays", () => {
    const k = L("Ball").ks.s.k[0];
    expect(k.o.x).toEqual([0.2, 0.6]);
  });
  test("hold keyframes carry h: 1", () => {
    expect(L("Star").ks.o.k[0].h).toBe(1);
  });
  test("orbits become a null parent with the rotation", () => {
    const nul = L("Moon orbit");
    expect(nul.ty).toBe(3);
    expect(nul.ks.r.a).toBe(1);
    expect(L("Moon").parent).toBe(nul.ind);
    expect(nul.parent).toBe(L("Star").ind);
  });
  test("bounce and OKLab colour are baked and reported", () => {
    expect(analysis.properties.find((p) => p.path === "Ball.position")!.fidelity).toBe("baked");
    expect(analysis.properties.find((p) => p.path === "Star.rotation")!.fidelity).toBe("exact");
  });
  test("off-frame keyframes are warned about; snap-to-frames removes the warning (§8.3)", () => {
    const a = one({ channels: { opacity: channel("opacity", [keyframe(0, 0), keyframe(0.51, 100)]) } });
    expect(exportLottie(a).analysis.warnings.join()).toMatch(/between frames/);
    expect(exportLottie(snapToFrames(a)).analysis.warnings).toEqual([]);
  });
  test("dotLottie round-trips the JSON", () => {
    expect(fromDotLottie(toDotLottie(json))).toEqual(json);
  });
});

describe("import (M7, §16.4)", () => {
  test("export → import → export is idempotent for the subset", () => {
    const first = exportLottie(bounceAndSpin()).json;
    const imported = importLottie(first);
    expect(imported.issues.filter((i) => i.severity === "error")).toEqual([]);
    const second = exportLottie(imported.animation!).json;
    const third = exportLottie(importLottie(second).animation!).json;
    expect(third).toEqual(second);
    expect(second.layers.length).toBe(first.layers.length);
    // Keyframe content survives (names and layer order aside).
    const kf = (j: typeof first, nm: string) => j.layers.find((l: { nm: string }) => l.nm === nm).ks;
    expect(kf(second, "Star").r).toEqual(kf(first, "Star").r);
    expect(kf(second, "Ball").p).toEqual(kf(first, "Ball").p);
  });
  test("unsupported features are errors, not silent drops", () => {
    const r = importLottie({ v: "5.9.0", fr: 30, ip: 0, op: 30, w: 10, h: 10, layers: [{ ty: 5, nm: "Text", ks: {} }, { ty: 4, nm: "M", hasMask: true, ks: {}, shapes: [] }] });
    expect(r.animation).toBeNull();
    expect(r.issues.map((i) => i.message).join()).toMatch(/text/); expect(r.issues.map((i) => i.message).join()).toMatch(/masks/);
  });
  test("split position (px/py) with different times is combined and baked", () => {
    const kx = { a: 1, k: [{ t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } }, { t: 30, s: [100] }] };
    const ky = { a: 1, k: [{ t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } }, { t: 15, s: [50], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } }, { t: 30, s: [0] }] };
    const r = importLottie({ v: "5.9.0", fr: 30, ip: 0, op: 30, w: 100, h: 100, layers: [{ ty: 4, nm: "S", ind: 1, ks: { p: { s: true, x: kx, y: ky } }, shapes: [], ip: 0, op: 30 }] });
    const p = r.animation!.layers[0]!.channels.position!;
    expect(p.keyframes.length).toBeGreaterThan(3);
    expect(p.keyframes.at(-1)!.value).toEqual([100, 0]);
  });
});

describe("drivers (stretch goal §17)", () => {
  test("a driven property follows its source and is baked on export", async () => {
    const { setDriverScope, layerValue } = await import("../../src/model/evaluate.js");
    const a = bounceAndSpin();
    const bar = a.layers.find((l) => l.id === "bar")!;
    bar.drivers = [{ property: "rotation", source: { layerId: "ball", property: "position", dim: 0 }, multiply: 0.5, add: 0 }];
    setDriverScope(a.layers);
    const ball = a.layers.find((l) => l.id === "ball")!;
    expect(layerValue(bar, "rotation", 1)).toBeCloseTo((layerValue(ball, "position", 1) as number[])[0]! * 0.5, 9);
    for (const out of [exportCss(a).analysis, exportLottie(a).analysis]) {
      const r = out.properties.find((p) => p.path === "Bar.rotation")!;
      expect(r.fidelity).toBe("baked");
      expect(r.reason).toMatch(/driver/);
    }
  });
});
