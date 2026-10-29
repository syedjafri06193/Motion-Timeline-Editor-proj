/**
 * Preset easings (§11.3): CSS keywords, the Penner set, Material curves, and
 * the curves a cubic bezier cannot make — marked `needsLinear` (§9.3).
 */
import type { CubicBezier } from "./bezier.js";
import { springAt } from "./spring.js";

export type EasingFunctionName = "bounce-out" | "bounce-in" | "bounce-in-out" | "elastic-out" | "elastic-in" | "elastic-in-out" | "spring";

export interface Preset {
  name: string;
  group: "CSS" | "Penner" | "Material" | "Physics";
  bezier?: CubicBezier;
  fn?: EasingFunctionName;
  /** True when no cubic-bezier() can express it: CSS export uses linear(). */
  needsLinear: boolean;
}

const b = (x1: number, y1: number, x2: number, y2: number): CubicBezier => ({ x1, y1, x2, y2 });

function bounceOut(x: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

const C4 = (2 * Math.PI) / 3, C5 = (2 * Math.PI) / 4.5;

export const EASING_FUNCTIONS: Record<EasingFunctionName, (x: number) => number> = {
  "bounce-out": bounceOut,
  "bounce-in": (x) => 1 - bounceOut(1 - x),
  "bounce-in-out": (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
  "elastic-out": (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * C4) + 1),
  "elastic-in": (x) => (x <= 0 ? 0 : x >= 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * C4)),
  "elastic-in-out": (x) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * C5)) / 2 : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * C5)) / 2 + 1,
  spring: (x) => springAt(x),
};

export const PRESETS: Preset[] = [
  { name: "linear", group: "CSS", bezier: b(0, 0, 1, 1), needsLinear: false },
  { name: "ease", group: "CSS", bezier: b(0.25, 0.1, 0.25, 1), needsLinear: false },
  { name: "ease-in", group: "CSS", bezier: b(0.42, 0, 1, 1), needsLinear: false },
  { name: "ease-out", group: "CSS", bezier: b(0, 0, 0.58, 1), needsLinear: false },
  { name: "ease-in-out", group: "CSS", bezier: b(0.42, 0, 0.58, 1), needsLinear: false },
  { name: "sine-in", group: "Penner", bezier: b(0.12, 0, 0.39, 0), needsLinear: false },
  { name: "sine-out", group: "Penner", bezier: b(0.61, 1, 0.88, 1), needsLinear: false },
  { name: "sine-in-out", group: "Penner", bezier: b(0.37, 0, 0.63, 1), needsLinear: false },
  { name: "quad-in", group: "Penner", bezier: b(0.11, 0, 0.5, 0), needsLinear: false },
  { name: "quad-out", group: "Penner", bezier: b(0.5, 1, 0.89, 1), needsLinear: false },
  { name: "quad-in-out", group: "Penner", bezier: b(0.45, 0, 0.55, 1), needsLinear: false },
  { name: "cubic-in", group: "Penner", bezier: b(0.32, 0, 0.67, 0), needsLinear: false },
  { name: "cubic-out", group: "Penner", bezier: b(0.33, 1, 0.68, 1), needsLinear: false },
  { name: "cubic-in-out", group: "Penner", bezier: b(0.65, 0, 0.35, 1), needsLinear: false },
  { name: "quart-in", group: "Penner", bezier: b(0.5, 0, 0.75, 0), needsLinear: false },
  { name: "quart-out", group: "Penner", bezier: b(0.25, 1, 0.5, 1), needsLinear: false },
  { name: "quart-in-out", group: "Penner", bezier: b(0.76, 0, 0.24, 1), needsLinear: false },
  { name: "expo-in", group: "Penner", bezier: b(0.7, 0, 0.84, 0), needsLinear: false },
  { name: "expo-out", group: "Penner", bezier: b(0.16, 1, 0.3, 1), needsLinear: false },
  { name: "expo-in-out", group: "Penner", bezier: b(0.87, 0, 0.13, 1), needsLinear: false },
  { name: "circ-in", group: "Penner", bezier: b(0.55, 0, 1, 0.45), needsLinear: false },
  { name: "circ-out", group: "Penner", bezier: b(0, 0.55, 0.45, 1), needsLinear: false },
  { name: "back-in", group: "Penner", bezier: b(0.36, 0, 0.66, -0.56), needsLinear: false },
  { name: "back-out", group: "Penner", bezier: b(0.34, 1.56, 0.64, 1), needsLinear: false },
  { name: "back-in-out", group: "Penner", bezier: b(0.68, -0.6, 0.32, 1.6), needsLinear: false },
  { name: "elastic-in", group: "Penner", fn: "elastic-in", needsLinear: true },
  { name: "elastic-out", group: "Penner", fn: "elastic-out", needsLinear: true },
  { name: "elastic-in-out", group: "Penner", fn: "elastic-in-out", needsLinear: true },
  { name: "bounce-in", group: "Penner", fn: "bounce-in", needsLinear: true },
  { name: "bounce-out", group: "Penner", fn: "bounce-out", needsLinear: true },
  { name: "bounce-in-out", group: "Penner", fn: "bounce-in-out", needsLinear: true },
  { name: "standard", group: "Material", bezier: b(0.2, 0, 0, 1), needsLinear: false },
  { name: "emphasized-decelerate", group: "Material", bezier: b(0.05, 0.7, 0.1, 1), needsLinear: false },
  { name: "emphasized-accelerate", group: "Material", bezier: b(0.3, 0, 0.8, 0.15), needsLinear: false },
  { name: "spring", group: "Physics", fn: "spring", needsLinear: true },
];
