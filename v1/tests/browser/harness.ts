/**
 * Browser-side test harness (tests/browser/run.mjs drives it with Playwright).
 * Everything compares our evaluator with what the browser or lottie-web does:
 *  - easingVsWaapi: cubic-bezier() through the Web Animations API (§5.3, §16.1)
 *  - renderPreview / renderCss / renderLottie: the same scene three ways, read back as pixels (§16.2, §16.3)
 */
import lottie from "lottie-web";
import { easeAt } from "../../src/easing/bezier.js";
import { exportCss, type CssOptions } from "../../src/export/css/emit.js";
import { exportLottie } from "../../src/export/lottie/emit.js";
import { bounceAndSpin, manyLayers } from "../../src/fixtures.js";
import type { Animation } from "../../src/model/types.js";
import { DEFAULT_ONION, OnionRenderer } from "../../src/render/onion.js";
import { render } from "../../src/render/scene.js";
import { drawTimeline } from "../../src/timeline/canvas.js";

const scenes: Record<string, () => Animation> = { bounceAndSpin, many20: () => manyLayers(20), many50: () => manyLayers(50) };
const stage = document.getElementById("stage")!;

function easingVsWaapi(curves: number[][], steps = 100): { maxError: number; worst: number[] } {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px";
  document.body.appendChild(el);
  let maxError = 0, worst: number[] = [];
  for (const [x1, y1, x2, y2] of curves) {
    // Large range so computed values carry enough digits: the browser serialises to ~6 significant figures.
    const a = el.animate([{ transform: "translateX(0px)" }, { transform: "translateX(100000px)" }], { duration: 1000, easing: `cubic-bezier(${x1},${y1},${x2},${y2})`, fill: "both" });
    a.pause();
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      a.currentTime = p * 1000;
      const m = new DOMMatrix(getComputedStyle(el).transform);
      const err = Math.abs(m.m41 / 100000 - easeAt(p, x1!, y1!, x2!, y2!));
      if (err > maxError) { maxError = err; worst = [x1!, y1!, x2!, y2!, p]; }
    }
    a.cancel();
  }
  el.remove();
  return { maxError, worst };
}

let canvas: HTMLCanvasElement | null = null;
function renderPreview(scene: string, time: number): void {
  const anim = scenes[scene]!();
  stage.replaceChildren();
  canvas = document.createElement("canvas");
  canvas.width = anim.width; canvas.height = anim.height;
  stage.style.width = `${anim.width}px`; stage.style.height = `${anim.height}px`;
  stage.appendChild(canvas);
  render(canvas.getContext("2d")!, anim, time);
}

function renderCss(scene: string, time: number, opts: CssOptions = {}): string[] {
  const anim = scenes[scene]!();
  const out = exportCss(anim, opts);
  stage.replaceChildren();
  const style = document.createElement("style");
  style.textContent = out.css;
  const host = document.createElement("div");
  host.id = "css";
  host.innerHTML = out.html;
  stage.append(style, host);
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = time * 1000; }
  return out.analysis.properties.filter((p) => p.fidelity !== "exact").map((p) => `${p.path}:${p.fidelity}`);
}

let player: ReturnType<typeof lottie.loadAnimation> | null = null;
async function renderLottie(scene: string, time: number): Promise<void> {
  const anim = scenes[scene]!();
  const { json } = exportLottie(anim);
  player?.destroy();
  stage.replaceChildren();
  const host = document.createElement("div");
  host.id = "lottie";
  host.style.width = `${anim.width}px`; host.style.height = `${anim.height}px`;
  stage.appendChild(host);
  player = lottie.loadAnimation({ container: host, renderer: "svg", loop: false, autoplay: false, animationData: json });
  await new Promise<void>((r) => (player!.isLoaded ? r() : player!.addEventListener("DOMLoaded", () => r())));
  player.goToAndStop(time * anim.frameRate, true);
}

/** Onion-skin scrub benchmark (M2): ms per frame while scrubbing with 3+3 skins. */
function scrubBenchmark(scene: string, frames = 120): { mean: number; p99: number; skinRenders: number } {
  const anim = scenes[scene]!();
  const c = document.createElement("canvas");
  c.width = anim.width; c.height = anim.height;
  stage.replaceChildren(c);
  const ctx = c.getContext("2d")!;
  const onion = new OnionRenderer();
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    onion.draw(ctx, anim, (f / frames) * anim.duration, DEFAULT_ONION, false);
    ctx.getImageData(0, 0, 1, 1); // force the GPU to finish
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, p99: times[Math.floor(times.length * 0.99)]!, skinRenders: onion.renders };
}

/** Timeline redraw cost (M3): 50 layers, all expanded, scrolling. */
function timelineBenchmark(frames = 120): { mean: number; p99: number } {
  const anim = manyLayers(50);
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 300;
  stage.replaceChildren(c);
  const ctx = c.getContext("2d")!;
  const view = { width: 1200, height: 300, headerHeight: 24, rowHeight: 22, labelWidth: 170, pxPerSecond: 220, scrollX: 0, scrollY: 0, expanded: new Set(anim.layers.map((l) => l.id)) };
  const th = { bg: "#fff", panel: "#eee", grid: "#ddd", text: "#111", muted: "#777", key: "#888", keySel: "#36f", accent: "#36f", row: "#f6f6f6" };
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    view.scrollY = (f * 37) % 4000;
    const t0 = performance.now();
    drawTimeline(ctx, anim, view, { playhead: f / 60, selected: new Set(), theme: th });
    ctx.getImageData(0, 0, 1, 1);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, p99: times[Math.floor(times.length * 0.99)]! };
}

Object.assign(window, { timelineBenchmark, easingVsWaapi, renderPreview, renderCss, renderLottie, scrubBenchmark, ready: true });
