#!/usr/bin/env node
/**
 * Browser verification (§16.1–16.3, §16.5). Builds nothing itself: run
 * `npm run test:browser`, which builds tests/browser/dist first.
 *  1. Easing vs WAAPI on the guide's control-point grid plus pathological cases: max error < 1e-4.
 *  2. The demo scene rendered by the canvas preview, by lottie-web, and by the
 *     exported CSS, compared pixel by pixel at many times.
 *  3. Onion-skin scrub performance on 20- and 50-layer scenes.
 * Runs in every installed Playwright browser.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const { chromium, firefox, webkit } = createRequire(import.meta.url)("playwright");
const root = new URL("./dist/", import.meta.url).pathname;
const out = new URL("../../out/browser/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/harness.html"));
  if (!p.startsWith(root) || !existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/harness.html`;

const only = process.argv.slice(2);
const want = (b) => !only.length || only.includes(b);
const cart = (...xs) => xs.reduce((acc, x) => acc.flatMap((a) => x.map((v) => [...a, v])), [[]]);
const GRID = [
  ...cart([0, 0.25, 0.42, 0.5, 0.75, 1], [-0.5, 0, 0.5, 1, 1.5], [0, 0.25, 0.58, 0.75, 1], [-0.5, 0, 0.5, 1, 1.5]),
  [1, 0, 0, 1], [0, 0, 1, 1], [0.68, -0.6, 0.32, 1.6], [0.1, 2, 0.9, -1], [0, 1, 1, 0], [1, 1, 0, 0],
];

async function shot(page, w, h) {
  return PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
}
function diff(a, b, name) {
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.2, includeAA: false });
  const frac = n / (a.width * a.height);
  if (frac > 0.002) writeFileSync(join(out, `${name}.png`), PNG.sync.write(d));
  return frac;
}

let failures = 0, ran = 0;
const results = {};
for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  if (!want(name)) continue;
  let browser;
  try { browser = await type.launch(); } catch { console.log(`${name}: not installed, skipped`); continue; }
  ran++;
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => { console.log(`${name} page error: ${e.message}`); failures++; });
  await page.goto(url);
  await page.waitForFunction(() => window.ready);
  const r = (results[name] = {});

  // 1. Easing against the browser
  const e = await page.evaluate((g) => window.easingVsWaapi(g), GRID);
  r.easing = { curves: GRID.length, maxError: e.maxError, worst: e.worst };
  const easingOk = e.maxError < 1e-4;
  console.log(`${name}: easing vs WAAPI over ${GRID.length} curves: max error ${e.maxError.toExponential(2)} ${easingOk ? "✓" : "✗ " + JSON.stringify(e.worst)}`);
  if (!easingOk) failures++;

  // 2. Preview vs lottie-web vs CSS
  const times = Array.from({ length: 31 }, (_, i) => +(i * 0.1).toFixed(2)).filter((t) => t < 3);
  let worstL = 0, worstC = 0, worstO = 0;
  for (const t of times) {
    await page.evaluate((t) => window.renderPreview("bounceAndSpin", t), t);
    const mine = await shot(page, 800, 600);
    await page.evaluate((t) => window.renderLottie("bounceAndSpin", t), t);
    const lot = await shot(page, 800, 600);
    await page.evaluate((t) => window.renderCss("bounceAndSpin", t), t);
    const css = await shot(page, 800, 600);
    await page.evaluate((t) => window.renderCss("bounceAndSpin", t, { offsetPath: true }), t);
    const off = await shot(page, 800, 600);
    worstL = Math.max(worstL, diff(mine, lot, `${name}-lottie-${t}`));
    worstC = Math.max(worstC, diff(mine, css, `${name}-css-${t}`));
    worstO = Math.max(worstO, diff(mine, off, `${name}-offset-${t}`));
  }
  r.pixels = { frames: times.length, lottie: worstL, css: worstC, cssOffsetPath: worstO };
  const LIMIT = 0.005; // ≤ 0.5% of pixels differ (anti-aliasing excluded) in the worst frame
  for (const [k, v] of Object.entries({ "lottie-web": worstL, "CSS (baked)": worstC, "CSS (offset-path)": worstO })) {
    console.log(`${name}: preview vs ${k}: worst frame ${(v * 100).toFixed(3)}% of pixels differ ${v <= LIMIT ? "✓" : "✗"}`);
    if (v > LIMIT) failures++;
  }

  // 3. Scrub performance
  for (const s of ["many20", "many50"]) {
    const b = await page.evaluate((s) => window.scrubBenchmark(s), s);
    r[`scrub-${s}`] = b;
    const ok = b.p99 < 16.7;
    console.log(`${name}: scrub ${s} with 3+3 onion skins: mean ${b.mean.toFixed(2)} ms, p99 ${b.p99.toFixed(2)} ms ${ok ? "✓ (60 fps)" : "✗ over the 16.7 ms frame budget"}`);
    if (!ok && s === "many20") failures++; // M2: 3+3 skins at 60 fps on a 20-layer scene
  }
  const tb = await page.evaluate(() => window.timelineBenchmark());
  r.timeline50 = tb;
  const tok = tb.p99 < 16.7;
  console.log(`${name}: 50-layer timeline redraw while scrolling: mean ${tb.mean.toFixed(2)} ms, p99 ${tb.p99.toFixed(2)} ms ${tok ? "✓" : "✗"}`);
  if (!tok) failures++;
  await browser.close();
}
server.close();
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
process.exit(failures || !ran ? 1 : 0);
