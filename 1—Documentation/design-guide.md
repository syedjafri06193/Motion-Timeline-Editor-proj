# Motion Timeline Editor — Design & Build Guide

**Project:** Keyframe editor with editable bezier easing curves, onion-skinning, and export to Lottie JSON or raw CSS keyframe animations
**Language:** TypeScript
**Status of this document:** planning + reference

---

## Table of contents

1. [Executive summary and scope](#1-executive-summary-and-scope)
2. [Reality check](#2-reality-check)
3. [The export capability matrix](#3-the-export-capability-matrix)
4. [The animation model](#4-the-animation-model)
5. [Easing evaluation](#5-easing-evaluation)
6. [Interpolation by type](#6-interpolation-by-type)
7. [Onion skinning](#7-onion-skinning)
8. [Lottie export](#8-lottie-export)
9. [CSS export](#9-css-export)
10. [The timeline UI](#10-the-timeline-ui)
11. [The curve editor](#11-the-curve-editor)
12. [Tech stack and setup](#12-tech-stack-and-setup)
13. [Repository layout](#13-repository-layout)
14. [Milestone ladder](#14-milestone-ladder)
15. [Reference implementations](#15-reference-implementations)
16. [Testing](#16-testing)
17. [Stretch goals](#17-stretch-goals)
18. [References](#18-references)

---

## 1. Executive summary and scope

### The original statement

> Keyframe editor with editable bezier easing curves, onion-skinning, and export to Lottie JSON or raw CSS keyframe animations.

Five findings reshape this:

1. **Lottie and CSS have incompatible animation models, and exporting to both means the internal model must be the richer one with a documented lossy path to CSS.** Lottie gives per-property keyframe times, per-*dimension* easing, and spatial bezier motion paths. CSS animates `transform` as a single property with one easing per segment. These are not the same expressive power, and pretending otherwise produces exports that silently differ from the preview. See section 3.
2. **Spatial motion paths have no CSS equivalent at all.** Lottie's `ti`/`to` tangents curve the path an element travels. CSS interpolates transform values linearly, which means a straight line in space. A curved path must be baked into many keyframes — this is the single largest Lottie→CSS loss and it must be surfaced, not silently applied. See section 9.4.
3. **CSS `linear()` is now the escape hatch for complex easing, and it reached Baseline Widely Available in June 2026.** A cubic bezier is a cubic function and cannot cross itself, so it can only produce monotonic S-curves — bounces and springs are impossible. `linear()` approximates any curve with values above 1 or below 0 for overshoot. The export rule is clean: cubic-bezier when the curve is expressible as one, `linear()` when it isn't. See section 9.3.
4. **Individual transform properties help, but their composition order is fixed.** `translate`, `rotate`, and `scale` are independent animatable properties in all modern browsers — a big win over the `transform` shorthand. But they always apply in the order translate → rotate → scale regardless of how you declare them. A motion model that composes differently (rotate-then-translate, common for orbital motion) cannot use them. See section 9.2.
5. **Bezier easing evaluation is root-finding, not direct parameter use, and the naive version is a visibly wrong classic bug.** Given a time fraction *x*, you must solve *x(t) = x* for the bezier parameter *t*, then evaluate *y(t)*. Using *t* as time directly produces easing that looks approximately right and is measurably wrong. Worse, your preview must match the browser's own implementation or the preview lies about the CSS export. See section 5.

### Revised project statement

> A keyframe editor with a Lottie-shaped internal model: per-property channels with per-keyframe in/out tangents, Newton-Raphson bezier easing matched to browser behavior, canvas-rendered preview with onion skinning, lossless Lottie export, and CSS export with an explicit capability analysis that reports what was baked, what was approximated, and what could not be represented.

### Explicit non-goals

- **Not an After Effects replacement.** No effects, no masks, no mattes, no expressions, no precomps.
- **Not a full Lottie implementer.** You emit a well-defined subset (§8.2) and validate it against a real player.
- **Not a vector illustration tool.** Elements come from somewhere else — SVG import, DOM nodes, images.
- **Not a video exporter in v1.** Rendering to MP4 or WebM is a stretch goal.
- **Not 3D.** 2D transforms only. Lottie's 3D layer support is limited and CSS 3D compounds every problem in section 3.

---

## 2. Reality check

### 2.1 The failure modes

| Symptom | Cause |
|---|---|
| Easing looks subtly wrong | Bezier parameter used as time (§5.1) |
| Preview and exported CSS differ | Your evaluator doesn't match the browser's (§5.3) |
| X and Y keyframes merge on CSS export | `transform` is one property (§9.1) |
| Curved motion becomes a straight line | Spatial tangents have no CSS equivalent (§9.4) |
| Bounce easing exports as a soft ease | Cubic bezier can't cross itself; needs `linear()` (§9.3) |
| Rotation takes the short way round | Shortest-path interpolation on an accumulating property (§6.2) |
| Rotate-around-point breaks on CSS export | Individual transform property order is fixed (§9.2) |
| Timing shifts slightly after Lottie export | Frame quantization (§8.3) |
| Onion skinning tanks the frame rate | 2n+1 full renders per frame (§7.2) |
| Timeline becomes sluggish with many layers | DOM-rendered keyframes (§10.1) |
| Undo history full of one-pixel drags | No coalescing (§10.4) |

### 2.2 What's actually hard

The editor UI is visible work but well-trodden. The hard parts are:

- **Matching the browser's easing evaluation** closely enough that the preview is trustworthy
- **The export capability analysis** — knowing what can't be represented and saying so
- **Baking with quality bounds** — how many keyframes does a curve need to be visually indistinguishable?
- **Onion skinning without destroying the frame rate**

---

## 3. The export capability matrix ★

This table should exist in the codebase, drive the export warnings, and be in the user documentation. It is the project's central honest statement.

| Capability | Lottie | CSS | Notes |
|---|---|---|---|
| Per-property keyframe times | ✅ | ⚠️ | Only for genuinely independent CSS properties |
| Per-keyframe in/out easing | ✅ | ✅ | CSS via `animation-timing-function` inside a keyframe block |
| **Per-dimension easing (X ≠ Y)** | ✅ | ❌ | `translate` is one property |
| **Spatial bezier motion path** | ✅ | ❌ | Must bake (§9.4) |
| Bounce / spring / elastic | ✅ | ✅ | Via `linear()` (§9.3) |
| Overshoot (y outside [0,1]) | ✅ | ✅ | Legal in `cubic-bezier` and `linear()` |
| Non-monotonic time | ✅ | ❌ | `cubic-bezier` x is constrained to [0,1] |
| Arbitrary transform order | ✅ | ⚠️ | Individual properties are fixed translate→rotate→scale (§9.2) |
| Animated anchor point | ✅ | ✅ | `transform-origin` is animatable |
| Hold / step keyframes | ✅ | ✅ | `steps()` or `linear()` with repeated values |
| Time remapping | ✅ | ❌ | |
| Per-layer independent timing | ✅ | ✅ | Separate `animation` per element |

**Three rows are hard losses**: per-dimension easing, spatial motion paths, and non-monotonic time. Everything else is either fine or an approximation with bounded error.

### 3.1 Surface the loss, don't hide it

The export dialog should report, per animated property:

```ts
interface ExportAnalysis {
  target: "lottie" | "css";
  properties: Array<{
    path: string;                  // "layer3.position.x"
    fidelity: "exact" | "approximated" | "baked" | "unrepresentable";
    reason?: string;
    bakedKeyframeCount?: number;
    maxError?: number;             // in the property's own units
  }>;
  warnings: string[];
}
```

"Your curved motion path was baked into 47 keyframes with a maximum deviation of 0.3px" is a useful sentence. Silently emitting a straight line is not.

---

## 4. The animation model

### 4.1 Model the richer format

Because Lottie is strictly more expressive than CSS, the internal model should be Lottie-shaped. Modelling on CSS and upconverting means you can never express what Lottie allows.

```ts
interface Animation {
  duration: number;              // seconds — NOT frames (§8.3)
  frameRate: number;             // for Lottie export and onion-skin stepping
  layers: Layer[];
}

interface Layer {
  id: string;
  name: string;
  content: LayerContent;         // svg | image | dom | shape
  parent?: string;               // parenting, for hierarchical transforms
  channels: Record<string, Channel>;
  inPoint: number;
  outPoint: number;
}

interface Channel {
  property: PropertyPath;        // "position.x", "rotation", "opacity"
  type: "number" | "vector2" | "color" | "angle";
  keyframes: Keyframe[];
  /** Spatial tangents only apply to vector2 position channels. */
  spatial: boolean;
}

interface Keyframe {
  time: number;                  // seconds
  value: number | number[] | Color;
  /** Temporal easing. Per-dimension arrays allowed, matching Lottie. */
  easeOut: BezierHandle;         // controls the segment leaving this keyframe
  easeIn: BezierHandle;          // controls the segment arriving at this keyframe
  /** Spatial tangents, position channels only. */
  spatialOut?: [number, number];
  spatialIn?: [number, number];
  hold?: boolean;                // step, no interpolation
}

interface BezierHandle {
  x: number[];                   // one entry = shared, N entries = per-dimension
  y: number[];
}
```

The per-dimension `x`/`y` arrays mirror Lottie exactly, which makes export trivial and makes the CSS limitation explicit in the type — if `x.length > 1`, CSS can't represent it.

### 4.2 Time is seconds, internally

Lottie is frame-based; CSS is percentage-based. **Neither should be the internal representation.**

Store seconds as a float. Convert at export: to frames for Lottie (`time * frameRate`), to percentages for CSS (`time / duration * 100`). Storing frames means changing the frame rate silently retimes everything; storing percentages means changing duration does.

### 4.3 Segment easing lives between keyframes

A common modelling mistake is putting one easing on a keyframe. Easing describes a *segment*, and each segment has two handles: the outgoing handle of the left keyframe and the incoming handle of the right one.

```
  kf[i] ──────────── segment ──────────── kf[i+1]
    └─ easeOut                    easeIn ─┘
       (P1 of the cubic)     (P2 of the cubic)
```

This matches both Lottie's `o`/`i` and CSS's `cubic-bezier(x1, y1, x2, y2)` where (x1,y1) is P1 and (x2,y2) is P2. The last keyframe's `easeOut` and the first's `easeIn` are unused.

---

## 5. Easing evaluation ★

### 5.1 It's root-finding, not parameter substitution

A cubic-bezier easing curve is parametric. With P0 = (0,0) and P3 = (1,1):

```
x(t) = 3(1−t)²t·x1 + 3(1−t)t²·x2 + t³
y(t) = 3(1−t)²t·y1 + 3(1−t)t²·y2 + t³
```

**`t` is the bezier parameter, not time.** Given a time fraction `x`, you need `y` — which requires solving `x(t) = x` for `t` first.

The naive implementation treats `t` as time and evaluates `y(t)` directly. The result *looks* like easing and is measurably wrong: for `cubic-bezier(0.42, 0, 0.58, 1)` the error peaks around 6% of the range near the midpoint. Enough to be visible when compared side by side, and enough that the preview disagrees with the browser.

### 5.2 Newton-Raphson with bisection fallback

This is what browser engines do, and matching their approach is the point.

```ts
const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 10;

function sampleCurve(a: number, b: number, t: number): number {
  // Horner form of 3(1−t)²t·a + 3(1−t)t²·b + t³
  const c = 3 * a;
  const bb = 3 * (b - a) - c;
  const aa = 1 - c - bb;
  return ((aa * t + bb) * t + c) * t;
}

function sampleDerivative(a: number, b: number, t: number): number {
  const c = 3 * a;
  const bb = 3 * (b - a) - c;
  const aa = 1 - c - bb;
  return (3 * aa * t + 2 * bb) * t + c;
}

/** Solve x(t) = x for t. */
function solveT(x: number, x1: number, x2: number): number {
  let t = x;                                     // decent initial guess

  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = sampleDerivative(x1, x2, t);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;   // flat — Newton diverges
    t -= (sampleCurve(x1, x2, t) - x) / slope;
  }

  // Bisection fallback for the flat-slope cases Newton can't handle.
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
    const current = sampleCurve(x1, x2, t);
    if (Math.abs(current - x) < SUBDIVISION_PRECISION) return t;
    if (current > x) hi = t; else lo = t;
    t = (hi + lo) / 2;
  }
  return t;
}

export function easeAt(x: number, x1: number, y1: number,
                       x2: number, y2: number): number {
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return x;   // linear fast path
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return sampleCurve(y1, y2, solveT(x, x1, x2));
}
```

The `NEWTON_MIN_SLOPE` guard matters. A curve with a flat region — `cubic-bezier(1, 0, 0, 1)` is the extreme — has near-zero derivative where Newton's step explodes. Falling through to bisection there is what makes the solver robust.

### 5.3 Verify against the browser ★

Your evaluator drives the canvas preview (§7). The browser evaluates the exported CSS. **If they disagree, the preview is lying about the export**, which is the one thing this tool must not do.

Verify it mechanically:

```ts
async function verifyAgainstBrowser(x1: number, y1: number, x2: number, y2: number) {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:-9999px;width:1px;height:1px;`;
  document.body.appendChild(el);

  const anim = el.animate(
    [{ transform: "translateX(0px)" }, { transform: "translateX(1000px)" }],
    { duration: 1000, easing: `cubic-bezier(${x1},${y1},${x2},${y2})`, fill: "both" }
  );
  anim.pause();

  const errors: number[] = [];
  for (let p = 0; p <= 1; p += 0.01) {
    anim.currentTime = p * 1000;
    const m = new DOMMatrix(getComputedStyle(el).transform);
    errors.push(Math.abs(m.m41 / 1000 - easeAt(p, x1, y1, x2, y2)));
  }
  el.remove();
  return { maxError: Math.max(...errors) };
}
```

Run it across a grid of control points in CI. A max error above ~1e-4 means your solver and the browser's have diverged and the preview cannot be trusted.

### 5.4 Cache the solve

`solveT` is called once per property per frame. At 60fps with 50 animated properties that's 3,000 solves per second — fine, but free to avoid.

Precompute a sample table per unique curve (11 to 33 samples) and linearly interpolate, falling back to the full solve when precision matters. This is what Blink does, and it's a meaningful win when onion skinning multiplies the render count (§7.2).

---

## 6. Interpolation by type

### 6.1 The type decides the math

```ts
type Interpolator<T> = (a: T, b: T, t: number) => T;

const INTERPOLATORS: Record<ChannelType, Interpolator<any>> = {
  number:  (a, b, t) => a + (b - a) * t,
  vector2: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  angle:   lerpAngleAccumulating,   // §6.2 — NOT shortest path
  color:   lerpColor,               // §6.3 — NOT raw sRGB
  hold:    (a, _b, _t) => a,
};
```

### 6.2 Rotation accumulates; it does not take the shortest path ★

This is the opposite of the right answer for hue, and the reason is worth understanding.

For a color wheel, 350° and 10° are 20° apart and interpolating the long way is a bug. For **motion**, a keyframe at 0° and a keyframe at 720° means *two full rotations*, and taking the "shortest path" (zero) discards the animation entirely.

```ts
// Motion rotation: the value IS the accumulated angle. Just lerp it.
function lerpAngleAccumulating(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

So: **store rotation as an unwrapped, accumulating value in degrees** and interpolate linearly. Never normalize it to [0, 360).

The consequence for the UI: when a user types "45" into a rotation field for a layer currently at 710°, do they mean 45 or 765? Offer both — a "revolutions + degrees" input, as After Effects does, makes the intent explicit and is the right affordance.

### 6.3 Color interpolation needs a chosen space

Lerping sRGB values produces muddy midpoints — red to green passes through brown rather than through yellow.

But here there's a constraint the poster project didn't have: **you're exporting to two systems that each interpolate colors their own way.**

- **Lottie** stores colors as 0–1 RGBA arrays and players lerp those components directly.
- **CSS** interpolates in sRGB by default for legacy color values, though `color-mix()` and modern color syntax allow specifying a space.

So a perceptually-correct OKLab interpolation in your preview will *not* match what a Lottie player does. Three options:

| Approach | Preview matches export? | Looks good? |
|---|---|---|
| Lerp in sRGB | ✅ both | ❌ muddy |
| Lerp in OKLab | ❌ neither | ✅ |
| **Lerp in OKLab, bake extra keyframes** | ✅ both | ✅ |

**Baking is the right answer.** Interpolate perceptually in the editor, then emit enough intermediate keyframes that the target's naive sRGB lerp between them traces the same path within a ΔE tolerance. Usually 3–5 extra keyframes per color transition suffices.

Report it in the export analysis (§3.1) so the user knows why their two color keyframes became six.

### 6.4 Hold keyframes

A hold keyframe means no interpolation — the value snaps at the next keyframe. Lottie expresses this with `h: 1`; CSS with `steps(1, end)` or by repeating the value.

Worth supporting early. Step animation is a whole aesthetic, and it's cheap.

---

## 7. Onion skinning

### 7.1 What it is

Render the scene at neighbouring times with reduced opacity, so the motion path and spacing are visible at a glance. Standard conventions:

- **Past frames tinted one color** (often red or blue), **future frames another** (often green)
- Opacity falling off with distance
- Configurable count before and after
- Step in frames, or in keyframes (only show neighbouring keyframes — often more useful)

### 7.2 It forces a canvas renderer ★

Onion skinning requires rendering the same scene at 2n+1 different times simultaneously. With DOM elements that means cloning the subtree n times per frame and applying different transforms — expensive, and it breaks anything stateful.

**So the preview is canvas-rendered, driven by your own evaluator**, not by the browser's animation engine.

That's the right call anyway (you need frame-accurate scrubbing, which CSS animations make awkward), but it has a consequence: **the preview no longer uses the code path that the CSS export will run through.** That's precisely why §5.3 exists.

```ts
function renderWithOnionSkin(ctx: CanvasRenderingContext2D, anim: Animation,
                             time: number, cfg: OnionConfig): void {
  const step = cfg.mode === "frames" ? 1 / anim.frameRate : keyframeStep(anim, time);

  for (let i = cfg.before; i >= 1; i--) {
    const t = time - i * step;
    if (t < 0) continue;
    ctx.globalAlpha = cfg.baseAlpha * (1 - i / (cfg.before + 1));
    renderTinted(ctx, anim, t, cfg.pastTint);
  }
  for (let i = cfg.after; i >= 1; i--) {
    const t = time + i * step;
    if (t > anim.duration) continue;
    ctx.globalAlpha = cfg.baseAlpha * (1 - i / (cfg.after + 1));
    renderTinted(ctx, anim, t, cfg.futureTint);
  }
  ctx.globalAlpha = 1;
  render(ctx, anim, time);     // current frame last, fully opaque
}
```

### 7.3 Keeping it fast

With 3 before and 3 after you're doing 7× the render work.

- **Cache onion-skin layers.** They only change when the animation or the current time changes, and during a scrub only some of them shift. Render each skin to its own offscreen canvas and composite.
- **Render skins at reduced resolution.** They're semi-transparent guides; half resolution is invisible in practice and quarters the cost.
- **Skip skins during playback.** Onion skinning is a scrubbing and posing tool, not a playback tool. Auto-disable on play and restore on pause — most users expect this and nobody complains.
- **Motion-path overlay as a cheaper alternative.** Drawing the interpolated path of a layer's anchor as a polyline, with dots at frame intervals, conveys most of the same information for a fraction of the cost. Offer both.

That last point deserves emphasis: a motion path with frame dots shows spacing — the thing animators actually read from onion skins — more legibly than ghosted copies, and costs one polyline.

---

## 8. Lottie export

### 8.1 Structure

```json
{
  "v": "5.9.0",
  "fr": 60,
  "ip": 0,
  "op": 180,
  "w": 800,
  "h": 600,
  "nm": "My Animation",
  "assets": [],
  "layers": [{
    "ddd": 0, "ind": 1, "ty": 4, "nm": "Layer 1",
    "ks": {
      "a": { "a": 0, "k": [50, 50, 0] },
      "p": { "a": 1, "k": [ /* keyframes */ ] },
      "s": { "a": 0, "k": [100, 100, 100] },
      "r": { "a": 1, "k": [ /* keyframes */ ] },
      "o": { "a": 0, "k": 100 }
    },
    "ip": 0, "op": 180, "st": 0
  }]
}
```

A keyframe:

```json
{
  "t": 30,
  "s": [100, 200],
  "i": { "x": [0.667], "y": [1] },
  "o": { "x": [0.333], "y": [0] },
  "to": [20, -10],
  "ti": [-15, 5]
}
```

Details that matter:

- **`a: 0` means static, `a: 1` means animated.** A property with one keyframe should be emitted as static, not as a one-element keyframe array — some players handle the latter badly.
- **`i`/`o` arrays can be length 1 (shared) or length N (per-dimension).** This is the capability CSS lacks entirely.
- **`to`/`ti` are spatial tangents, position only**, expressed as offsets from the keyframe's own value.
- **Scale is percent**, not a multiplier: 100 is 1×.
- **Opacity is 0–100**, not 0–1.
- **Rotation is degrees**, and accumulates (§6.2) — Lottie handles 720° correctly.

### 8.2 Declare your subset

Lottie is enormous — shapes, masks, track mattes, effects, text, images, precomps, expressions. You're emitting transform animations on simple layers, which is a small fraction of it.

**Write down exactly which layer types, properties, and features you emit**, and put it in the docs. A user who imports your JSON into a tool expecting shape layers should find out from your documentation rather than from a blank canvas.

Lottie has historically been defined by "whatever Bodymovin writes and lottie-web plays" rather than a formal specification, though there's now a formal specification effort under way. **Validate against an actual player**, not against the spec text — §16.2.

### 8.3 Frame quantization ★

Lottie times are in frames. Your model is in seconds (§4.2). Conversion quantizes.

```ts
function toFrames(seconds: number, frameRate: number): number {
  return seconds * frameRate;       // fractional frames ARE legal in Lottie
}
```

Fractional frame times are valid in the format, but **many tools and some players round them**, which shifts your timing. A keyframe at 1.5 frames may land at 1 or 2 depending on who reads the file.

Two mitigations:

- **Offer a "snap to frames" mode** that quantizes in the editor, so what you see is what exports.
- **Warn when keyframes fall off frame boundaries** and report the maximum shift that rounding would cause.

Also: **changing the frame rate must not retime the animation.** Because the model is in seconds, it won't — but the keyframe positions relative to frame boundaries change, so re-run the warning.

### 8.4 Spatial tangents

For position channels, `to` and `ti` define the curvature of the motion path:

```ts
function emitPositionKeyframe(kf: Keyframe, next: Keyframe | null): LottieKeyframe {
  const out: LottieKeyframe = {
    t: toFrames(kf.time, frameRate),
    s: kf.value as number[],
    o: { x: kf.easeOut.x, y: kf.easeOut.y },
    i: next ? { x: next.easeIn.x, y: next.easeIn.y } : undefined,
  };
  if (kf.spatialOut) out.to = kf.spatialOut;   // offsets from s, not absolute
  if (next?.spatialIn) out.ti = next.spatialIn;
  return out;
}
```

The tangents are **offsets from the keyframe's own position**, not absolute coordinates — an easy thing to get backwards, and the symptom is a motion path that flies off toward the origin.

---

## 9. CSS export

### 9.1 `transform` is one property ★

The fundamental constraint. A single CSS property animates as a unit, which means every component inside `transform` shares keyframe times and one easing per segment.

So a timeline with X keyframed at 0s/0.3s/1s and Y keyframed at 0s/0.5s/1s cannot map directly. You must resample both onto the union of keyframe times — and once resampled, the per-channel easing is wrong at the inserted keyframes, so you have to bake.

### 9.2 Individual transform properties, and their fixed order ★

`translate`, `rotate`, and `scale` are separate animatable CSS properties, supported across all modern browsers (Chrome since 104; Firefox and Safari earlier). Each can carry its own keyframes and easing:

```css
@keyframes move {
  0%   { translate: 0 0; }
  30%  { translate: 100px 0; animation-timing-function: cubic-bezier(.4,0,.2,1); }
  100% { translate: 200px 50px; }
}
@keyframes spin {
  0%   { rotate: 0deg; }
  50%  { rotate: 180deg; }
  100% { rotate: 720deg; }
}
.el { animation: move 2s, spin 2s; }
```

This is a major improvement: rotation and translation can now have genuinely independent timing.

**But the composition order is fixed: translate, then rotate, then scale**, regardless of declaration order. That happens to match Lottie's transform composition (position outermost, then rotation, then scale around the anchor), which is fortunate.

It also means **a motion model composing transforms in a different order cannot use these properties.** Rotate-then-translate — the natural way to express orbital motion — is not expressible. The fallback is the `transform` shorthand with everything coupled, or nesting elements one per transform component.

Detect it and report it:

```ts
function canUseIndividualTransforms(layer: Layer): boolean {
  // Individual properties are always translate → rotate → scale.
  return layer.transformOrder === "TRS";
}
```

**X and Y remain coupled inside `translate`.** If they have different keyframe times, resample-and-bake (§9.5).

### 9.3 `linear()` for curves a bezier can't make ★

A cubic bezier is a cubic function, so it cannot cross itself — it produces only monotonic S-curves. Bounce, spring, and elastic easings oscillate and are simply not expressible as `cubic-bezier()`.

`linear()` solves this by approximating any curve with a list of output values, with optional percentage hints, and values outside [0,1] producing overshoot:

```css
/* Bounce — impossible as a cubic bezier */
animation-timing-function: linear(0, 1.2 60%, 0.9, 1.05, 1);
```

It reached **Baseline Newly Available on 2023-12-11** (Chrome 113, Firefox 112, Safari 17.2) and **Baseline Widely Available on 2026-06-11**. As of now it's safe to emit without a fallback for current browsers, though a `cubic-bezier` fallback declaration costs nothing.

The export decision rule:

```ts
function cssEasingFor(segment: Segment): string {
  if (isExpressibleAsCubicBezier(segment)) {
    const { x1, y1, x2, y2 } = segment.bezier;
    return `cubic-bezier(${x1},${y1},${x2},${y2})`;
  }
  // Sample the curve and emit linear(). Precision is a quality setting.
  return emitLinear(segment, { samples: 20, tolerance: 0.002 });
}

function emitLinear(segment: Segment, opts: LinearOpts): string {
  // Adaptive sampling: more points where curvature is high.
  const points = adaptiveSample(segment, opts.tolerance);
  const parts = points.map((p, i) =>
    i === 0 || i === points.length - 1
      ? p.y.toFixed(4)
      : `${p.y.toFixed(4)} ${(p.x * 100).toFixed(2)}%`
  );
  return `linear(${parts.join(", ")})`;
}
```

**Adaptive sampling matters.** Uniform sampling of a bounce wastes points on the flat sections and under-resolves the bounce itself. Sample by curvature and you get a better approximation from fewer points, which keeps the CSS readable.

### 9.4 Spatial motion paths must be baked ★

The largest Lottie→CSS loss. Lottie's spatial tangents curve the path an element travels through space; CSS interpolates transform values, which traces a straight line between them.

There is no CSS mechanism for this. (`offset-path` animates along an SVG path and is a genuine alternative — see §17 — but it's a different animation model, not a translation of keyframed transforms.)

So: bake.

```ts
function bakeSpatialPath(channel: Channel, opts: BakeOpts): Keyframe[] {
  const baked: Keyframe[] = [];

  for (let i = 0; i < channel.keyframes.length - 1; i++) {
    const a = channel.keyframes[i], b = channel.keyframes[i + 1];
    if (!a.spatialOut && !b.spatialIn) { baked.push(a); continue; }

    // Subdivide until the polyline is within tolerance of the true curve.
    const n = subdivisionsFor(a, b, opts.tolerancePx);
    for (let s = 0; s < n; s++) {
      const t = s / n;
      baked.push({
        time: a.time + (b.time - a.time) * easeAt(t, ...temporalBezier(a, b)),
        value: evaluateSpatialBezier(a, b, t),
        easeOut: LINEAR, easeIn: LINEAR,     // baked segments are linear
      });
    }
  }
  baked.push(channel.keyframes.at(-1)!);
  return baked;
}
```

Two subtleties in that function:

**Temporal easing must be applied when choosing sample times**, not just sample positions. Otherwise you bake the correct path with the wrong timing along it.

**Baked segments become linear**, because the subdivision already encodes the shape. Leaving the original easing on them would apply it twice.

Report the keyframe count and the tolerance in the export analysis. "47 keyframes, max deviation 0.3px" tells the user what they got.

### 9.5 Resampling coupled channels

When X and Y have different keyframe times and must share a `translate` property:

```ts
function coupleChannels(x: Channel, y: Channel, tolerance: number): Keyframe[] {
  const times = [...new Set([...x.keyframes, ...y.keyframes].map(k => k.time))].sort((a,b)=>a-b);

  // At the union times, each channel's easing is only correct at its own
  // original keyframes. Between them we must bake.
  const needsBaking = x.keyframes.some(k => !y.keyframes.find(o => o.time === k.time))
                   || y.keyframes.some(k => !x.keyframes.find(o => o.time === k.time));

  if (!needsBaking) {
    return times.map(t => combineAt(x, y, t));      // exact
  }
  return bakeToTolerance(x, y, tolerance);           // approximate, and report it
}
```

The `!needsBaking` fast path matters — a lot of real animations do have aligned keyframes, and those export exactly. Only report a loss when there is one.

### 9.6 Generated output

```css
@keyframes layer1-translate {
  0%   { translate: 0px 0px; animation-timing-function: cubic-bezier(0.33,0,0.67,1); }
  30%  { translate: 100px 20px; animation-timing-function: linear(0,1.2 60%,0.9,1.05,1); }
  100% { translate: 200px 50px; }
}

.layer1 {
  animation: layer1-translate 2s both,
             layer1-rotate    2s both;
  transform-origin: 50px 50px;   /* from the Lottie anchor point */
  will-change: translate, rotate;
}
```

`animation-timing-function` inside a keyframe block applies to the segment **starting** at that keyframe — that's the direction people most often get backwards.

`will-change` on animated properties is worth emitting, with a note that it should be removed if the element isn't animating continuously.

---

## 10. The timeline UI

### 10.1 Canvas, not DOM ★

A timeline with 40 layers × 25 keyframes is 1,000 interactive elements. As DOM nodes with drag handlers, that's sluggish before you've done anything interesting, and it gets worse with every layer.

Render the timeline to a canvas and do your own hit testing:

```ts
interface HitTarget {
  kind: "keyframe" | "segment" | "layerBar" | "playhead" | "handle";
  layerId?: string;
  channelId?: string;
  keyframeIndex?: number;
}

function hitTest(x: number, y: number, view: TimelineView): HitTarget | null {
  const row = Math.floor((y - view.headerHeight + view.scrollY) / view.rowHeight);
  const layer = view.visibleLayers[row];
  if (!layer) return null;

  const time = (x - view.trackLeft + view.scrollX) / view.pxPerSecond;
  for (const ch of layer.channels) {
    for (const [i, kf] of ch.keyframes.entries()) {
      if (Math.abs(kf.time - time) * view.pxPerSecond < HIT_RADIUS) {
        return { kind: "keyframe", layerId: layer.id, channelId: ch.id, keyframeIndex: i };
      }
    }
  }
  return { kind: "layerBar", layerId: layer.id };
}
```

Virtualize vertically (only draw visible rows) and horizontally (only keyframes within the visible time range). A ten-minute timeline at frame resolution is a lot of ticks.

### 10.2 Snapping

Snap to: frame boundaries, other keyframes on any layer, the playhead, markers, and layer in/out points. With a modifier key to disable.

Show the snap target visually while dragging. A faint vertical line to the thing you're snapping to removes all ambiguity about what just happened.

### 10.3 Selection

Multi-select with marquee, shift-click, and select-all-on-a-layer. Then: move as a group, scale in time (drag the edge of a selection to retime proportionally), reverse, and copy/paste.

**Time scaling is the operation that's easy to forget and hard to live without.** Selecting a range of keyframes and dragging its edge to make the whole sequence 20% faster is core to how animators work.

### 10.4 Undo with coalescing ★

A keyframe drag produces a new state on every mouse-move. Pushing each one is an undo history the user cannot navigate.

```ts
class History {
  private stack: Command[] = [];
  private coalescing: Command | null = null;

  begin(cmd: Command): void { this.coalescing = cmd; }

  update(state: State): void {
    if (this.coalescing) this.coalescing.after = state;   // replace, don't push
  }

  commit(): void {
    if (this.coalescing && !statesEqual(this.coalescing.before, this.coalescing.after)) {
      this.stack.push(this.coalescing);
    }
    this.coalescing = null;
  }
}
```

The `statesEqual` check discards no-op drags — a click that moves a keyframe zero pixels shouldn't consume an undo slot.

---

## 11. The curve editor

### 11.1 Two views

**Segment easing view** — the normalized 0–1 bezier for one segment, with draggable P1 and P2 handles. This is the `cubic-bezier` editor everyone recognizes.

**Value graph view** — all channels plotted as value against time, with tangent handles at each keyframe, like After Effects' graph editor. Harder to build, and how animators actually work once a scene gets complex.

Ship the segment view first; the value graph is the milestone that makes the tool feel professional.

### 11.2 Constraints on the handles

For a CSS-exportable curve, **x must stay in [0,1]** — that's the `cubic-bezier` requirement and it's what keeps time monotonic. Y is unconstrained, which is how overshoot works.

```ts
function clampHandle(h: Point, target: ExportTarget): Point {
  return {
    x: target === "css" ? clamp(h.x, 0, 1) : h.x,
    y: h.y,   // overshoot is legal in both
  };
}
```

**Show the constraint in the UI.** If CSS is a target, draw the legal x range and resist dragging past it, with a tooltip explaining why. Silently clamping at export is worse than preventing the input.

### 11.3 Presets and the curve library

Ship the standard easings — the CSS keywords, the Penner set (quad/cubic/quart/expo/back/elastic/bounce, in/out/inOut), and Material-style curves.

**Mark which ones need `linear()`.** Elastic and bounce cannot be cubic beziers (§9.3), and showing that in the preset list teaches the constraint at the moment it's relevant.

### 11.4 Curve preview

A small animated dot replaying the segment on loop, next to the curve. It communicates the feel of an easing far better than the shape does, and it's twenty lines.

---

## 12. Tech stack and setup

| Layer | Choice | Why |
|---|---|---|
| **Language** | TypeScript | |
| **Preview render** | Canvas2D | Onion skinning requires it (§7.2) |
| **Timeline render** | Canvas2D with hit testing | DOM doesn't scale (§10.1) |
| **UI chrome** | React or Svelte, panels only | Never inside the render loop |
| **Lottie validation** | `lottie-web` in an iframe | Validate against a real player (§16.2) |
| **CSS validation** | Web Animations API | The browser is the reference (§5.3) |
| **SVG import** | Your own parser, or `svgson` | For layer content |
| **State** | Immutable updates + command history | Undo (§10.4) |

Two setup notes:

**Get `lottie-web` running early**, rendering your export side by side with your preview. That comparison is the Lottie equivalent of §5.3, and it's the only way to know your JSON means what you think.

**Build the export analysis (§3.1) before the exporters.** If the capability matrix is a data structure from the start, the exporters consult it rather than each growing its own ad-hoc warnings.

---

## 13. Repository layout

```
Motion-Timeline-Editor/
├── README.md
├── docs/
│   ├── design.md                ← this document
│   ├── export-matrix.md         ← ★ what each target can and can't do
│   └── lottie-subset.md         ← ★ exactly what we emit
├── src/
│   ├── model/
│   │   ├── animation.ts
│   │   ├── channel.ts
│   │   ├── keyframe.ts
│   │   └── interpolate.ts       ← ★ per-type (§6)
│   ├── easing/
│   │   ├── bezier.ts            ← ★ Newton-Raphson + bisection (§5.2)
│   │   ├── cache.ts             ← sample tables (§5.4)
│   │   ├── presets.ts
│   │   └── verify.ts            ← ★ against the browser (§5.3)
│   ├── render/
│   │   ├── scene.ts
│   │   ├── onion.ts             ← ★ (§7)
│   │   └── motionPath.ts        ← the cheaper alternative (§7.3)
│   ├── timeline/
│   │   ├── canvas.ts
│   │   ├── hitTest.ts
│   │   ├── snap.ts
│   │   └── select.ts
│   ├── curves/
│   │   ├── segmentEditor.ts
│   │   └── valueGraph.ts
│   ├── export/
│   │   ├── analysis.ts          ← ★ the capability matrix, as code
│   │   ├── lottie/
│   │   │   ├── emit.ts
│   │   │   ├── spatial.ts
│   │   │   └── quantize.ts      ← frame rounding warnings (§8.3)
│   │   └── css/
│   │       ├── emit.ts
│   │       ├── easing.ts        ← ★ bezier vs linear() decision (§9.3)
│   │       ├── bake.ts          ← ★ spatial + coupled channels (§9.4, §9.5)
│   │       └── couple.ts
│   ├── history/
│   └── ui/
└── tests/
    ├── easing/                  ← ★ browser verification
    ├── lottie/                  ← ★ player round-trip
    └── css/                     ← ★ WAAPI comparison
```

---

## 14. Milestone ladder

### M0 — The export capability matrix ★ **before any export code**
**Est. 3–4 days**

Write `docs/export-matrix.md` and encode it as a data structure. Decide which Lottie subset you emit and write `docs/lottie-subset.md`.

The internal model follows from this. Model Lottie's expressiveness and you can always downgrade; model CSS's and you can never upgrade.

**Done when:** for every model capability, you can state what each target does with it.

---

### M1 — Model and easing evaluation ★
**Est. 1.5 weeks**

The animation model, per-type interpolation, the Newton-Raphson solver, sample caching, **and the browser verification harness**.

**Build verification in this milestone.** Everything downstream assumes the evaluator is trustworthy, and it isn't until you've measured it against the browser.

**Done when:** max error against WAAPI is below 1e-4 across a grid of control points, in CI.

---

### M2 — Canvas preview and onion skinning
**Est. 1.5 weeks**

Scene rendering, frame-accurate scrubbing, onion skin with caching and reduced-resolution skins, motion path overlay.

**Done when:** scrubbing with 3+3 onion skins holds 60fps on a 20-layer scene.

---

### M3 — Timeline UI
**Est. 2.5 weeks**

Canvas timeline, hit testing, virtualization, drag, snap, multi-select, time scaling, undo with coalescing.

**Done when:** a 50-layer timeline is fluid, and no drag produces more than one undo step.

---

### M4 — Curve editor
**Est. 1.5 weeks**

Segment bezier editor with target-aware handle constraints, presets marked by CSS expressibility, animated curve preview.

---

### M5 — Lottie export ★
**Est. 2 weeks**

Emitter, spatial tangents, frame quantization warnings, and **side-by-side validation against `lottie-web`**.

**Done when:** a scene rendered by your preview and by `lottie-web` are pixel-comparable within tolerance across the whole timeline.

---

### M6 — CSS export ★
**Est. 2.5 weeks**

Individual transform properties with order detection, the bezier/`linear()` decision, adaptive `linear()` sampling, spatial baking, channel coupling with the exact fast path, and the export analysis report.

**Done when:** the generated CSS, played by the browser, matches your preview within tolerance — and where it can't, the analysis says so before the user exports.

---

### M7 — Import
**Est. 1.5 weeks**

Lottie import (your subset, with clear errors on unsupported features), SVG import for layer content.

Import makes the tool useful for editing existing work, which is a much larger use case than authoring from scratch.

---

### M8 — Value graph editor
**Est. 2 weeks**

All channels plotted over time with tangent handles. This is what makes it feel like a professional tool rather than a keyframe list.

---

## 15. Reference implementations

### 15.1 Adaptive `linear()` sampling

```ts
function adaptiveSample(curve: EasingCurve, tolerance: number): Point[] {
  const points: Point[] = [{ x: 0, y: curve.at(0) }];

  function subdivide(x0: number, x1: number, depth: number): void {
    if (depth > 8) return;                      // hard recursion cap
    const xm = (x0 + x1) / 2;
    const actual = curve.at(xm);
    const linear = (curve.at(x0) + curve.at(x1)) / 2;

    if (Math.abs(actual - linear) > tolerance) {
      subdivide(x0, xm, depth + 1);
      points.push({ x: xm, y: actual });
      subdivide(xm, x1, depth + 1);
    }
  }

  subdivide(0, 1, 0);
  points.push({ x: 1, y: curve.at(1) });
  return points.sort((a, b) => a.x - b.x);
}
```

The midpoint-deviation test puts points where curvature is high and leaves flat regions alone. A bounce ends up with dense sampling at the bounces and two points across the settle — which is both more accurate and shorter than uniform sampling.

### 15.2 Channel evaluation

```ts
export function evaluateChannel(ch: Channel, time: number): number | number[] {
  const kfs = ch.keyframes;
  if (kfs.length === 0) throw new Error("empty channel");
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs.at(-1)!.time) return kfs.at(-1)!.value;

  const i = binarySearchSegment(kfs, time);
  const a = kfs[i], b = kfs[i + 1];

  if (a.hold) return a.value;

  const raw = (time - a.time) / (b.time - a.time);

  // Per-dimension easing: Lottie allows it, so the model must.
  if (a.easeOut.x.length > 1) {
    return (a.value as number[]).map((av, d) => {
      const t = easeAt(raw, a.easeOut.x[d], a.easeOut.y[d],
                            b.easeIn.x[d],  b.easeIn.y[d]);
      return av + ((b.value as number[])[d] - av) * t;
    });
  }

  const t = easeAt(raw, a.easeOut.x[0], a.easeOut.y[0],
                        b.easeIn.x[0],  b.easeIn.y[0]);
  return INTERPOLATORS[ch.type](a.value, b.value, t);
}
```

Binary search rather than a linear scan matters once a channel has a few hundred baked keyframes, which happens as soon as you import someone else's Lottie.

---

## 16. Testing

### 16.1 Easing against the browser ★

```ts
const CONTROL_POINTS = cartesian(
  [0, 0.25, 0.42, 0.5, 0.75, 1],
  [-0.5, 0, 0.5, 1, 1.5],
  [0, 0.25, 0.58, 0.75, 1],
  [-0.5, 0, 0.5, 1, 1.5],
);

test.each(CONTROL_POINTS)("matches browser: cubic-bezier(%f,%f,%f,%f)",
  async (x1, y1, x2, y2) => {
    const { maxError } = await verifyAgainstBrowser(x1, y1, x2, y2);
    expect(maxError).toBeLessThan(1e-4);
  });
```

Include the pathological cases explicitly: `(1,0,0,1)` with its flat middle, `(0,0,1,1)` linear, and heavy-overshoot curves.

### 16.2 Lottie round-trip against a real player ★

```ts
test("lottie export renders identically to preview", async () => {
  const anim = loadFixture("bounce-and-spin.json");
  const player = await mountLottieWeb(exportLottie(anim));

  for (let f = 0; f < anim.duration * anim.frameRate; f++) {
    const t = f / anim.frameRate;
    const mine = renderToImageData(anim, t);
    const theirs = await player.renderFrame(f);
    expect(perceptualDiff(mine, theirs)).toBeLessThan(0.02);
  }
});
```

Validating against the player rather than the spec is the point. Lottie's real definition has historically been what `lottie-web` does.

### 16.3 CSS export against WAAPI

Same shape: generate the CSS, apply it via the Web Animations API, sample `getComputedStyle` at intervals, compare against your evaluator. Where you baked, assert the error is within the declared tolerance — and that the analysis *reported* the baking.

### 16.4 Property tests

- `evaluateChannel` at a keyframe's exact time returns that keyframe's value
- Evaluation is monotonic in time for monotonic channels
- `solveT(sampleCurve(x1,x2,t), x1, x2) ≈ t` — the solver inverts the sampler
- Baking then evaluating matches the original within tolerance
- Export → import → export is idempotent for the supported subset

### 16.5 Performance

Frame time with 50 layers, onion skinning on, during a scrub. Track p99 in CI. The timeline is an interactive tool, and a regression that pushes scrubbing below 60fps is a real bug.

---

## 17. Stretch goals

| Feature | Effort | Value |
|---|---|---|
| **`offset-path` CSS export** | Medium | The one CSS mechanism for curved motion (§9.4). A real alternative to baking for position channels. |
| **Video export** | Medium | `MediaRecorder` on `canvas.captureStream()`, or frame-by-frame to WebCodecs |
| **GIF / APNG export** | Small | Still widely requested |
| **Expressions / drivers** | Large | Link one property to another. Enormously powerful, enormously scoped. |
| **Motion blur** | Medium | Sample sub-frames and composite. Transforms a preview's realism. |
| **Audio waveform track** | Medium | Sync to sound — essential for anything narrative |
| **Spring physics easing** | Small | Solve a damped harmonic oscillator, bake to `linear()`. Falls straight out of §9.3. |
| **Collaborative editing** | Large | CRDT over the keyframe model |
| **dotLottie export** | Small | The zipped Lottie container format |
| **Figma or SVG animation import** | Medium | Meet users where their assets are |

The `offset-path` item deserves a second look. It's the only native CSS way to move an element along a curve, and for position channels with spatial tangents it converts an unrepresentable capability into an exact one — at the cost of a different animation model that can't be mixed freely with transform keyframes. Worth prototyping before committing.

---

## 18. References

### Specifications

| Source | For |
|---|---|
| **CSS Easing Functions Level 1 / Level 2** | `cubic-bezier`, `linear()`, `steps()` |
| MDN: `linear()` easing | Syntax and the percentage-hint form |
| **CSS Transforms Level 2** — individual `translate`, `rotate`, `scale` | §9.2, including the fixed composition order |
| CSS Animations Level 1 | `@keyframes`, per-keyframe `animation-timing-function` |
| Web Animations API | §5.3 and §16.3 — the browser as reference |
| **Lottie format documentation** and the formal specification effort | §8 |
| `lottie-web` source | The de facto reference for what Lottie means |

### Technique

- **Robert Penner's easing equations** — the canonical preset set
- WebKit's `UnitBezier` and Blink's `CubicBezier` — the Newton-plus-bisection approach in §5.2
- Jake Archibald's `linear()` easing generator — a good reference for adaptive sampling in practice
- *The Animator's Survival Kit* (Williams) and *The Illusion of Life* (Thomas & Johnston) — spacing, timing, and why onion skinning exists at all
- Björn Ottosson on OKLab — §6.3, color interpolation

### Prior art

- After Effects' graph editor — the value-graph model in §11.1
- Bodymovin — the original Lottie exporter; its output is the compatibility target
- Rive, Haiku, Keyshape — adjacent tools worth studying for interaction design
- `cubic-bezier.com` — the segment editor everyone already knows

---

## Appendix A — Decision record

| Decision | Rationale |
|---|---|
| **Model Lottie's expressiveness, not CSS's** | Lottie is strictly richer; you can always downgrade, never upgrade |
| **Write the export capability matrix before any exporter** | It determines the model, and it prevents each exporter growing ad-hoc warnings |
| Report fidelity per property on export | "Baked into 47 keyframes, max deviation 0.3px" is useful; a silent straight line is not |
| **Time stored in seconds, not frames or percentages** | Frames retime on frame-rate change; percentages retime on duration change |
| Easing belongs to segments, with two handles | Matches both Lottie's `o`/`i` and CSS's `cubic-bezier` P1/P2 |
| **Bezier easing is root-finding: solve x(t)=x, then evaluate y(t)** | Using `t` as time is a classic bug with ~6% peak error — visibly wrong |
| Newton-Raphson with a min-slope guard and bisection fallback | Newton diverges on flat regions like `cubic-bezier(1,0,0,1)` |
| **Verify the evaluator against the browser in CI** | The preview drives canvas; the export runs in the browser. If they diverge, the preview lies. |
| Cache solves in sample tables | Onion skinning multiplies evaluation count by 7× |
| **Rotation accumulates; never shortest-path** | 0° to 720° means two revolutions. This is the opposite of the right answer for hue, and the difference matters. |
| Color interpolated perceptually, then baked to extra keyframes | Lottie players and CSS lerp sRGB; baking makes the preview and the export agree *and* look right |
| **Onion skinning forces a canvas renderer** | DOM cloning at 2n+1 times per frame is unworkable — and this is why §5.3 exists |
| Onion skins cached, half-resolution, disabled during playback | 7× render cost is only acceptable while scrubbing |
| Motion-path overlay offered alongside | Shows spacing more legibly than ghosts, for the cost of one polyline |
| **`transform` is one CSS property** | X and Y with different keyframe times must be resampled and baked |
| Use individual `translate`/`rotate`/`scale` where possible | Genuinely independent properties with independent timing |
| **Detect transform order; individual properties are fixed translate→rotate→scale** | Rotate-then-translate (orbital motion) is not expressible with them |
| **`linear()` for anything a cubic bezier can't express** | A cubic can't cross itself, so bounce and spring are impossible as `cubic-bezier`. `linear()` reached Baseline Widely Available in June 2026. |
| Adaptive sampling for `linear()` | Uniform sampling wastes points on flat regions and under-resolves the bounce |
| **Spatial motion paths baked, with tolerance reported** | CSS has no equivalent at all; this is the largest single loss |
| Baked segments emit linear easing | The subdivision already encodes the shape; keeping the easing applies it twice |
| Temporal easing applied when choosing bake sample *times* | Otherwise the path is right and the timing is wrong |
| Exact fast path when coupled channels already share keyframe times | Many real animations do; only report a loss when there is one |
| Warn on off-frame keyframes for Lottie | Fractional frames are legal but many tools round them, shifting timing |
| **Canvas timeline with hit testing, not DOM** | 40 layers × 25 keyframes is 1,000 interactive nodes |
| Undo coalescing with a no-op check | A drag produces a state per mousemove; a zero-pixel drag shouldn't consume a slot |
| Curve handle x clamped to [0,1] when CSS is a target, shown in the UI | Silently clamping at export is worse than preventing the input |
| Presets marked by CSS expressibility | Teaches the `linear()` constraint at the moment it's relevant |
| **Validate Lottie against `lottie-web`, not against the spec text** | The format's real definition has historically been what the player does |

---

## Appendix B — Quick reference card

```
EXPORT LOSSES — Lottie → CSS
  per-dimension easing (X ≠ Y)   ❌ transform is ONE property
  spatial bezier motion path     ❌ no CSS equivalent → BAKE
  non-monotonic time             ❌ cubic-bezier x ∈ [0,1]
  arbitrary transform order      ⚠️ individual props are FIXED T→R→S
  bounce / spring / elastic      ✅ via linear()
  overshoot (y outside [0,1])    ✅ legal in both

EASING EVALUATION
  ★ t is the BEZIER PARAMETER, not time
    given x → solve x(t)=x for t → evaluate y(t)
    naive t-as-time peaks ~6% error — visibly wrong
  Newton-Raphson ×8, min-slope guard 0.001, bisection fallback ×10
  ★ verify against WAAPI in CI — max error < 1e-4
    the preview is canvas; the export runs in the browser

CSS EASING DECISION
  monotonic S-curve   → cubic-bezier(x1,y1,x2,y2)
  anything else       → linear(0, 1.2 60%, 0.9, 1.05, 1)
  linear(): Baseline Newly Available 2023-12-11
            Baseline Widely Available 2026-06-11
            Chrome 113 · Firefox 112 · Safari 17.2
  a cubic function cannot cross itself → no bounce as bezier
  sample adaptively by curvature, not uniformly

CSS TRANSFORMS
  individual translate/rotate/scale = independent animatable properties
  ★ order is ALWAYS translate → rotate → scale, regardless of declaration
    (happens to match Lottie: position → rotation → scale around anchor)
  X and Y still coupled inside translate
  animation-timing-function inside a keyframe applies to the segment
    STARTING at that keyframe

INTERPOLATION BY TYPE
  number   plain lerp
  ★ angle  ACCUMULATES — 0→720° is two revolutions, never shortest path
           (opposite of hue interpolation, and the difference matters)
  color    perceptual in the editor, BAKED to extra keyframes for export
           (Lottie players and CSS both lerp sRGB)
  hold     no interpolation; Lottie h:1, CSS steps(1,end)

LOTTIE
  time in FRAMES (fractional legal, but many tools round → warn)
  scale is PERCENT (100 = 1×) · opacity 0–100 · rotation degrees
  a:0 static, a:1 animated — one keyframe should emit as STATIC
  i/o easing arrays: length 1 = shared, length N = per-dimension
  to/ti are OFFSETS from the keyframe value, not absolute
  validate against lottie-web, not the spec text

ONION SKINNING
  ★ forces a canvas renderer (DOM can't render 2n+1 times)
  cache skins · half resolution · auto-disable on playback
  motion path + frame dots shows spacing better, for one polyline

TIMELINE
  canvas + hit testing; DOM dies at ~1,000 keyframes
  virtualize both axes · snap to frames/keyframes/playhead
  undo coalescing, with a no-op check on commit
```
