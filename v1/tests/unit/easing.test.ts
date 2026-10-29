import { describe, expect, test } from "vitest";
import { easeAt, naiveEaseAt, sampleCurve, solveT } from "../../src/easing/bezier.js";
import { cachedEase } from "../../src/easing/cache.js";
import { EASING_FUNCTIONS, PRESETS } from "../../src/easing/presets.js";
import { springAt } from "../../src/easing/spring.js";
import { linearFunction } from "../../src/export/css/easing.js";

const grid = [0, 0.1, 0.25, 0.42, 0.5, 0.58, 0.75, 0.9, 1];

describe("cubic-bezier evaluation (§5)", () => {
  test("solveT inverts sampleCurve across the control-point grid", () => {
    for (const x1 of grid) for (const x2 of grid) for (let t = 0; t <= 1; t += 0.05) {
      const x = sampleCurve(x1, x2, t);
      expect(Math.abs(sampleCurve(x1, x2, solveT(x, x1, x2)) - x)).toBeLessThan(1e-6);
    }
  });

  test("the naive bug (t used as time) is visibly wrong", () => {
    const worst = (x1: number, y1: number, x2: number, y2: number) => {
      let w = 0;
      for (let x = 0; x <= 1; x += 0.001) w = Math.max(w, Math.abs(naiveEaseAt(x, x1, y1, x2, y2) - easeAt(x, x1, y1, x2, y2)));
      return w;
    };
    // Measured peaks (see 1—Documentation/v1/easing.md): ease-in-out 2.9%, ease 28.7%, Material standard 47%.
    expect(worst(0.42, 0, 0.58, 1)).toBeGreaterThan(0.025);
    expect(worst(0.25, 0.1, 0.25, 1)).toBeGreaterThan(0.25);
    expect(worst(0.2, 0, 0, 1)).toBeGreaterThan(0.45);
  });

  test("flat-slope curves fall back to bisection: cubic-bezier(1, 0, 0, 1)", () => {
    for (let x = 0; x <= 1; x += 0.01) {
      const y = easeAt(x, 1, 0, 0, 1);
      // The curve is symmetric about (0.5, 0.5).
      expect(y + easeAt(1 - x, 1, 0, 0, 1)).toBeCloseTo(1, 5);
    }
    expect(easeAt(0.5, 1, 0, 0, 1)).toBeCloseTo(0.5, 5);
  });

  test("linear fast path, clamped ends, overshoot allowed", () => {
    expect(easeAt(0.3, 0, 0, 1, 1)).toBe(0.3);
    expect(easeAt(-1, 0.4, 0, 0.2, 1)).toBe(0);
    expect(easeAt(2, 0.4, 0, 0.2, 1)).toBe(1);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => easeAt(i / 100, 0.34, 1.56, 0.64, 1)))).toBeGreaterThan(1.05);
  });

  test("the sample-table cache agrees with the full solver to 5e-7 (both well inside the 1e-4 browser budget)", () => {
    for (const p of PRESETS.filter((p) => p.bezier)) for (let x = 0; x <= 1; x += 0.013) {
      const { x1, y1, x2, y2 } = p.bezier!;
      expect(Math.abs(cachedEase(x, x1, y1, x2, y2) - easeAt(x, x1, y1, x2, y2))).toBeLessThan(5e-7);
    }
  });
});

describe("presets and easing functions (§11.3, §9.3)", () => {
  test("every function preset starts at 0, ends at 1 and is marked as needing linear()", () => {
    for (const p of PRESETS.filter((p) => p.fn)) {
      expect(p.needsLinear).toBe(true);
      const f = EASING_FUNCTIONS[p.fn!];
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
  });
  test("bounce is non-monotonic, which no cubic-bezier can be", () => {
    const f = EASING_FUNCTIONS["bounce-out"];
    let reversals = 0, prev = f(0), dir = 0;
    for (let x = 0.002; x <= 1; x += 0.002) { const y = f(x), d = Math.sign(y - prev); if (d && dir && d !== dir) reversals++; if (d) dir = d; prev = y; }
    expect(reversals).toBeGreaterThanOrEqual(4);
  });
  test("spring settles exactly on 1 and overshoots on the way", () => {
    expect(springAt(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => springAt(i / 200)))).toBeGreaterThan(1.05);
  });
});

describe("linear() generation (§9.3, §15.1)", () => {
  test("adaptive sampling stays within tolerance for every function preset", () => {
    for (const fn of Object.keys(EASING_FUNCTIONS) as Array<keyof typeof EASING_FUNCTIONS>) {
      const l = linearFunction(EASING_FUNCTIONS[fn], 0.002);
      expect(l.maxError, fn).toBeLessThan(0.005);
      expect(l.css).toMatch(/^linear\(0, /);
      expect(l.css).toMatch(/, 1\)$/);
    }
  });
  test("adaptive beats uniform: fewer points than 1/tolerance", () => {
    expect(linearFunction(EASING_FUNCTIONS["bounce-out"], 0.002).points).toBeLessThan(120);
  });
});
