import { describe, expect, test } from "vitest";
import { deltaE, lerpColorOklab, lerpColorSrgb } from "../../src/model/color.js";
import { evaluateChannel, layerState } from "../../src/model/evaluate.js";
import { worldMatrix, apply } from "../../src/model/transform.js";
import { channel, keyframe, LINEAR_IN, LINEAR_OUT, type Animation } from "../../src/model/types.js";
import { bounceAndSpin } from "../../src/fixtures.js";

describe("channel evaluation (§15.2, §16.4)", () => {
  const ch = channel("position", [keyframe(0, [0, 0]), keyframe(1, [100, 50], { spatialIn: [-40, 60] }), keyframe(2, [200, 0], { hold: true }), keyframe(3, [0, 0])]);
  test("at a keyframe's exact time it returns that keyframe's value", () => {
    for (const k of ch.keyframes) expect(evaluateChannel(ch, k.time)).toEqual(k.value);
  });
  test("clamps before the first and after the last keyframe", () => {
    expect(evaluateChannel(ch, -1)).toEqual([0, 0]);
    expect(evaluateChannel(ch, 9)).toEqual([0, 0]);
  });
  test("hold keyframes snap", () => {
    expect(evaluateChannel(ch, 2.5)).toEqual([200, 0]);
  });
  test("monotonic channels evaluate monotonically", () => {
    const m = channel("opacity", [keyframe(0, 0), keyframe(1, 30), keyframe(4, 100)]);
    let prev = -Infinity;
    for (let t = 0; t <= 4; t += 0.01) { const v = evaluateChannel(m, t) as number; expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
  });
  test("rotation accumulates: 0° → 720° passes 360° (never shortest path, §6.2)", () => {
    const r = channel("rotation", [keyframe(0, 0, { easeOut: LINEAR_OUT }), keyframe(2, 720, { easeIn: LINEAR_IN })]);
    expect(evaluateChannel(r, 1)).toBeCloseTo(360, 6);
  });
  test("per-dimension easing evaluates each dimension with its own curve", () => {
    const s = channel("scale", [keyframe(0, [0, 0], { easeOut: { x: [0, 0.9], y: [0, 0] } }), keyframe(1, [100, 100], { easeIn: { x: [1, 1], y: [1, 1] } })]);
    const [x, y] = evaluateChannel(s, 0.5) as number[];
    expect(x).toBeCloseTo(50, 3); // linear
    expect(y!).toBeLessThan(30); // strong ease-in
  });
  test("spatial segments follow the curve by arc length", () => {
    const c = channel("position", [keyframe(0, [0, 0], { spatialOut: [0, -100], easeOut: LINEAR_OUT }), keyframe(1, [100, 0], { spatialIn: [0, -100], easeIn: LINEAR_IN })]);
    const mid = evaluateChannel(c, 0.5) as number[];
    expect(mid[0]).toBeCloseTo(50, 0);
    expect(mid[1]!).toBeLessThan(-70); // bowed upward, not a straight line
  });
});

describe("colour (§6.3)", () => {
  test("OKLab midpoint of red→green is brighter than the muddy sRGB midpoint", () => {
    const r = [1, 0, 0, 1] as const, g = [0, 1, 0, 1] as const;
    const ok = lerpColorOklab([...r], [...g], 0.5), srgb = lerpColorSrgb([...r], [...g], 0.5);
    expect(ok[0] + ok[1]).toBeGreaterThan(srgb[0] + srgb[1]);
    expect(deltaE(ok, srgb)).toBeGreaterThan(5);
  });
});

describe("transforms", () => {
  const anim: Animation = bounceAndSpin();
  test("TRS: the anchor lands on the position", () => {
    const ball = anim.layers.find((l) => l.id === "ball")!;
    const s = layerState(ball, 0);
    const p = apply(worldMatrix(anim, ball, 0), s.anchor[0], s.anchor[1]);
    expect(p[0]).toBeCloseTo(100, 6); expect(p[1]).toBeCloseTo(380, 6);
  });
  test("RTS orbit: the moon stays at a fixed distance from the star's centre", () => {
    const moon = anim.layers.find((l) => l.id === "moon")!, star = anim.layers.find((l) => l.id === "star")!;
    const dists = [0, 0.7, 1.3, 2.9].map((t) => {
      const c = apply(worldMatrix(anim, star, t), 50, 50), m = apply(worldMatrix(anim, moon, t), 12, 12);
      return Math.hypot(m[0] - c[0], m[1] - c[1]);
    });
    for (const d of dists) expect(d).toBeCloseTo(dists[0]!, 6);
  });
});
