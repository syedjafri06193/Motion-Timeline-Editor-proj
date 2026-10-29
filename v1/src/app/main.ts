/**
 * The editor. UI chrome is plain DOM; the preview, timeline, curve editor and
 * value graph are canvases (§10.1) — nothing in a render loop touches the DOM.
 */
import lottie from "lottie-web";
import { AudioTrack } from "./audio.js";
import { SegmentEditor } from "../curves/segmentEditor.js";
import type { ExportTarget } from "../curves/handles.js";
import { ValueGraph } from "../curves/valueGraph.js";
import { PRESETS } from "../easing/presets.js";
import { exportCss } from "../export/css/emit.js";
import { fromDotLottie, toDotLottie } from "../export/dotlottie.js";
import { exportLottie } from "../export/lottie/emit.js";
import { CAPABILITIES, type ExportAnalysis } from "../export/matrix.js";
import { exportGif, exportWebm } from "../export/media.js";
import { bounceAndSpin, manyLayers } from "../fixtures.js";
import { History } from "../history/history.js";
import { importLottie } from "../import/lottie.js";
import { importSvg } from "../import/svg.js";
import { deleteKeys, getKey, keyId, mapLayer, reverseKeys, setSegmentBezier, type KeyRef } from "../model/edit.js";
import { layerValue } from "../model/evaluate.js";
import { addKeyAt, copyKeys, joinRevolutions, pasteKeys, splitRevolutions, toggleHold, type Clip } from "../model/keys.js";
import type { Animation, Layer, PropertyName, Value } from "../model/types.js";
import { channel, keyframe } from "../model/types.js";
import { drawMotionPath } from "../render/motionPath.js";
import { renderMotionBlur } from "../render/motionBlur.js";
import { DEFAULT_ONION, OnionRenderer } from "../render/onion.js";
import { render } from "../render/scene.js";
import { drawTimeline, selectionRange } from "../timeline/canvas.js";
import { TimelineController } from "../timeline/controller.js";
import type { TimelineView } from "../timeline/view.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const history = new History<Animation>(bounceAndSpin(), (a, b) => a === b);
const anim = () => history.current;
let playing = false, lastTick = 0, dirty = true, graphMode = false, analysisTarget: "css" | "lottie" = "css";
let selectedLayer: string | null = "ball";
let clip: Clip | null = null;
const flags = { onion: false, path: false, blur: false, compare: false };
const onion = new OnionRenderer();
let onionCfg = { ...DEFAULT_ONION };

// ── Preview ────────────────────────────────────────────────────────────────
const preview = $<HTMLCanvasElement>("preview");
const pctx = preview.getContext("2d")!;
const scratch = document.createElement("canvas").getContext("2d")!;
function sizePreview() {
  const a = anim();
  if (preview.width !== a.width || preview.height !== a.height) { preview.width = a.width; preview.height = a.height; scratch.canvas.width = a.width; scratch.canvas.height = a.height; }
}

// ── Timeline ───────────────────────────────────────────────────────────────
const tl = $<HTMLCanvasElement>("timeline");
const view: TimelineView = { width: 800, height: 240, headerHeight: 24, rowHeight: 22, labelWidth: 170, pxPerSecond: 220, scrollX: 0, scrollY: 0, expanded: new Set(["ball"]) };
const controller = new TimelineController(history, view, { selection: [], playhead: 0 }, () => { dirty = true; changed(false); });

function fitCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = devicePixelRatio || 1, r = c.getBoundingClientRect();
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
const pos = (e: PointerEvent | WheelEvent, c: HTMLElement) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
tl.addEventListener("pointerdown", (e) => { tl.setPointerCapture(e.pointerId); const [x, y] = pos(e, tl); controller.down(x, y, { shift: e.shiftKey, alt: e.altKey }); syncSelectionToLayer(); });
tl.addEventListener("pointermove", (e) => { const [x, y] = pos(e, tl); controller.move(x, y, { shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey }); });
tl.addEventListener("pointerup", () => { controller.up(); changed(true); });
tl.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const [x] = pos(e, tl); const t = view.scrollX + (x - view.labelWidth) / view.pxPerSecond; view.pxPerSecond = Math.min(4000, Math.max(20, view.pxPerSecond * Math.exp(-e.deltaY * 0.002))); view.scrollX = Math.max(0, t - (x - view.labelWidth) / view.pxPerSecond); }
  else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.scrollX = Math.max(0, view.scrollX + (e.deltaX || e.deltaY) / view.pxPerSecond);
  else view.scrollY = Math.max(0, view.scrollY + e.deltaY);
  dirty = true;
}, { passive: false });

function syncSelectionToLayer() {
  const s = controller.state.selection[0];
  if (s) selectedLayer = s.layerId;
  dirty = true;
  updateSidePanels();
}

// ── Value graph ────────────────────────────────────────────────────────────
const graph = new ValueGraph($<HTMLCanvasElement>("graph"), anim);
let graphOpen = false;
graph.onEdit = (layer, final) => {
  if (!graphOpen) { history.begin("Edit curve"); graphOpen = true; }
  history.update(mapLayer(anim(), layer.id, () => layer));
  if (final) { history.commit(); graphOpen = false; changed(true); }
  dirty = true;
};

// ── Segment curve editor (§11) ─────────────────────────────────────────────
const seg = new SegmentEditor($<HTMLCanvasElement>("curve"));
let segOpen = false;
function selectedSegment(): KeyRef | null {
  const r = controller.state.selection.find((s) => { const ch = anim().layers.find((l) => l.id === s.layerId)?.channels[s.property]; return ch && s.index < ch.keyframes.length - 1; });
  return r ?? null;
}
seg.onInput = (c, final) => {
  const r = selectedSegment();
  if (!r) return;
  if (!segOpen) { history.begin("Edit easing"); segOpen = true; }
  history.update(setSegmentBezier(anim(), r, c));
  if (final) { history.commit(); segOpen = false; changed(true); }
  dirty = true;
};
function syncSegmentEditor() {
  const r = selectedSegment();
  const info = $("curveInfo");
  if (!r) { info.textContent = "Select a keyframe to edit the segment that leaves it."; return; }
  const ch = anim().layers.find((l) => l.id === r.layerId)!.channels[r.property]!;
  const a = ch.keyframes[r.index]!, b = ch.keyframes[r.index + 1]!;
  seg.curve = a.easeFn ? { x1: 0, y1: 0, x2: 1, y2: 1, fn: a.easeFn } : { x1: a.easeOut.x[0]!, y1: a.easeOut.y[0]!, x2: b.easeIn.x[0]!, y2: b.easeIn.y[0]! };
  const perDim = a.easeOut.x.length > 1 || b.easeIn.x.length > 1;
  info.textContent = `${r.property} ${a.time.toFixed(2)}s → ${b.time.toFixed(2)}s · ${a.hold ? "hold" : a.easeFn ? `${a.easeFn} (CSS: linear())` : `cubic-bezier(${seg.curve.x1}, ${seg.curve.y1}, ${seg.curve.x2}, ${seg.curve.y2})`}${perDim ? " · per-dimension: editing X (use the value graph for others)" : ""}`;
}
const presets = $("presets");
for (const p of PRESETS) {
  const b = document.createElement("button");
  b.textContent = p.name;
  if (p.needsLinear) { b.className = "lin"; b.title = "A cubic bezier can't cross itself: CSS export uses linear()"; }
  b.onclick = () => {
    const r = selectedSegment();
    if (!r) return;
    if (p.bezier) history.apply(`Easing: ${p.name}`, setSegmentBezier(anim(), r, p.bezier));
    else history.apply(`Easing: ${p.name}`, mapLayer(anim(), r.layerId, (l) => { const ch = l.channels[r.property]!; return { ...l, channels: { ...l.channels, [r.property]: { ...ch, keyframes: ch.keyframes.map((k, i) => (i === r.index ? { ...k, easeFn: p.fn } : k)) } } }; }));
    changed(true);
  };
  presets.appendChild(b);
}

// ── Inspector ──────────────────────────────────────────────────────────────
const PROPS: PropertyName[] = ["position", "scale", "rotation", "opacity", "anchor", "fill"];
function layer(): Layer | undefined { return anim().layers.find((l) => l.id === selectedLayer); }
function setValue(prop: PropertyName, v: Value) {
  const l = layer();
  if (!l) return;
  const ch = l.channels[prop];
  const t = controller.state.playhead;
  if (ch && ch.keyframes.length > 1) history.apply(`Set ${prop}`, addKeyAt(anim(), l.id, prop, t, v));
  else history.apply(`Set ${prop}`, mapLayer(anim(), l.id, (x) => ({ ...x, channels: { ...x.channels, [prop]: channel(prop, [keyframe(0, v)]) } })));
  changed(true);
}
function updateInspector() {
  const l = layer();
  $("layerName").textContent = l ? `— ${l.name}` : "";
  const box = $("inspector");
  box.replaceChildren();
  if (!l) { box.textContent = "Click a layer in the timeline."; return; }
  const t = controller.state.playhead;
  for (const p of PROPS) {
    const v = layerValue(l, p, t);
    const ch = l.channels[p];
    const keyHere = ch?.keyframes.some((k) => Math.abs(k.time - t) < 1e-6);
    const row = document.createElement("div");
    row.className = "prop";
    const name = document.createElement("span");
    name.textContent = p;
    if ((ch?.keyframes.length ?? 0) > 1) name.className = "keyed";
    const vals = document.createElement("div");
    vals.className = "vals";
    const num = (val: number, onSet: (n: number) => void, step = 1) => { const i = document.createElement("input"); i.type = "number"; i.step = String(step); i.value = String(+val.toFixed(3)); i.onchange = () => onSet(Number(i.value)); vals.appendChild(i); };
    if (p === "fill") {
      const c = document.createElement("input"); c.type = "color";
      const a = v as number[]; c.value = "#" + a.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
      c.onchange = () => { const h = c.value; setValue("fill", [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1]); };
      vals.appendChild(c);
    } else if (p === "rotation") {
      // Revolutions + degrees (§6.2): typing 45 on a layer at 710° is ambiguous.
      const { revolutions, degrees } = splitRevolutions(v as number);
      num(revolutions, (n) => setValue("rotation", joinRevolutions(n, splitRevolutions(layerValue(l, "rotation", t) as number).degrees)));
      num(degrees, (n) => setValue("rotation", joinRevolutions(splitRevolutions(layerValue(l, "rotation", t) as number).revolutions, n)));
      vals.title = "revolutions × 360 + degrees";
    } else if (typeof v === "number") num(v, (n) => setValue(p, n));
    else (v as number[]).forEach((x, d) => num(x, (n) => { const arr = [...(layerValue(l, p, t) as number[])]; arr[d] = n; setValue(p, arr); }));
    const key = document.createElement("button");
    key.textContent = keyHere ? "◆" : "◇";
    key.title = keyHere ? "Remove keyframe at playhead" : "Add keyframe at playhead (K)";
    key.onclick = () => {
      if (keyHere) { const idx = ch!.keyframes.findIndex((k) => Math.abs(k.time - t) < 1e-6); history.apply("Delete keyframe", deleteKeys(anim(), [{ layerId: l.id, property: p, index: idx }])); }
      else history.apply("Add keyframe", addKeyAt(anim(), l.id, p, t));
      changed(true);
    };
    row.append(name, vals, key);
    box.appendChild(row);
  }
}

// ── Export analysis (§3.1) ─────────────────────────────────────────────────
function analysisFor(target: "css" | "lottie"): ExportAnalysis {
  return target === "css" ? exportCss(anim(), { offsetPath: $<HTMLInputElement>("offsetPath").checked }).analysis : exportLottie(anim()).analysis;
}
function renderAnalysis(list: HTMLElement, a: ExportAnalysis) {
  list.replaceChildren();
  for (const p of a.properties) {
    const li = document.createElement("li");
    li.innerHTML = `<b class="${p.fidelity}">${p.fidelity}</b> ${p.path}${p.bakedKeyframeCount ? ` — ${p.bakedKeyframeCount} keyframes` : ""}${p.maxError !== undefined ? `, max deviation ${+p.maxError.toFixed(3)}` : ""}${p.reason ? `<br><span class="hint">${p.reason}</span>` : ""}`;
    list.appendChild(li);
  }
  for (const w of a.warnings) { const li = document.createElement("li"); li.innerHTML = `<b class="baked">warning</b> ${w}`; list.appendChild(li); }
  if (!list.children.length) list.innerHTML = "<li class='exact'>No animated properties.</li>";
}
let analysisTimer = 0;
function updateAnalysis() { clearTimeout(analysisTimer); analysisTimer = window.setTimeout(() => renderAnalysis($("analysis"), analysisFor(analysisTarget)), 120); }
document.querySelectorAll<HTMLButtonElement>("#analysisTabs button").forEach((b) => (b.onclick = () => { analysisTarget = b.dataset.t as "css" | "lottie"; document.querySelectorAll("#analysisTabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); updateAnalysis(); }));
$("matrix").innerHTML = `<tr><th>Capability</th><th>Lottie</th><th>CSS</th></tr>` + CAPABILITIES.map((c) => `<tr title="${c.notes}"><td>${c.label}</td><td class="${c.lottie}">${c.lottie}</td><td class="${c.css}">${c.css}</td></tr>`).join("");

// ── lottie-web side by side (§12: "get lottie-web running early") ──────────
let player: ReturnType<typeof lottie.loadAnimation> | null = null, lottieTimer = 0;
function reloadLottie() {
  clearTimeout(lottieTimer);
  if (!flags.compare) return;
  lottieTimer = window.setTimeout(() => {
    player?.destroy();
    const host = $("lottieView");
    host.querySelectorAll("svg").forEach((s) => s.remove());
    const a = anim();
    host.style.width = `${preview.getBoundingClientRect().width}px`;
    host.style.aspectRatio = `${a.width} / ${a.height}`;
    player = lottie.loadAnimation({ container: host, renderer: "svg", loop: false, autoplay: false, animationData: exportLottie(a).json });
    player.addEventListener("DOMLoaded", () => player?.goToAndStop(controller.state.playhead * a.frameRate, true));
  }, 150);
}

// ── Change plumbing ────────────────────────────────────────────────────────
function updateSidePanels() { updateInspector(); syncSegmentEditor(); graph.layer = layer() ?? null; }
function changed(structural: boolean) {
  dirty = true;
  if (structural) { onion.invalidate(); updateAnalysis(); reloadLottie(); }
  else onion.invalidate();
  updateSidePanels();
}

// ── Toolbar ────────────────────────────────────────────────────────────────
const toggle = (id: keyof typeof flags) => { flags[id] = !flags[id]; $(id).setAttribute("aria-pressed", String(flags[id])); dirty = true; if (id === "compare") { $("lottieView").hidden = !flags.compare; reloadLottie(); } };
for (const id of ["onion", "path", "blur", "compare"] as const) $(id).onclick = () => toggle(id);
$<HTMLSelectElement>("onionMode").onchange = (e) => { onionCfg = { ...onionCfg, mode: (e.target as HTMLSelectElement).value as "frames" | "keyframes" }; onion.invalidate(); dirty = true; };
$<HTMLSelectElement>("target").onchange = (e) => { const t = (e.target as HTMLSelectElement).value as ExportTarget; seg.target = t; graph.target = t; };
$<HTMLInputElement>("offsetPath").onchange = updateAnalysis;
const audio = new AudioTrack();
$("audioBtn").onclick = () => $("audioFile").click();
$<HTMLInputElement>("audioFile").onchange = async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { await audio.load(f); $("audioBtn").textContent = `♪ ${f.name.slice(0, 14)}`; dirty = true; } catch (err) { dialog("Audio", `Couldn't decode ${f.name}: ${(err as Error).message}`); } };
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "❚❚" : "▶"; lastTick = performance.now(); if (playing) audio.play(controller.state.playhead); else audio.stop(); };
$("undo").onclick = () => { history.undo(); changed(true); };
$("redo").onclick = () => { history.redo(); changed(true); };
$<HTMLSelectElement>("scene").onchange = (e) => {
  const v = (e.target as HTMLSelectElement).value;
  history.apply("Load scene", v === "bounce" ? bounceAndSpin() : manyLayers(v === "many20" ? 20 : 50));
  controller.state.selection = []; selectedLayer = anim().layers[0]?.id ?? null; controller.state.playhead = 0;
  changed(true);
};

function download(data: BlobPart | Uint8Array, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function dialog(title: string, body: HTMLElement | string, onOk?: () => void) {
  const d = $<HTMLDialogElement>("dlg");
  $("dlgTitle").textContent = title;
  const b = $("dlgBody");
  if (typeof body === "string") b.innerHTML = body; else b.replaceChildren(body);
  $("dlgOk").hidden = !onOk;
  $("dlgOk").onclick = () => { onOk?.(); d.close(); };
  $("dlgClose").onclick = () => d.close();
  d.showModal();
}
const slug = () => anim().name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
function exportWithReport(target: "css" | "lottie", go: () => void) {
  const a = analysisFor(target);
  const ul = document.createElement("ul");
  renderAnalysis(ul, a);
  const losses = a.properties.filter((p) => p.fidelity !== "exact").length;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p>${losses ? `${losses} propert${losses > 1 ? "ies are" : "y is"} not exported exactly. Review before you ship it:` : "Everything exports exactly."}</p>`;
  wrap.appendChild(ul);
  dialog(`Export ${target === "css" ? "CSS" : "Lottie"}`, wrap, go);
}
$("expLottie").onclick = () => exportWithReport("lottie", () => download(JSON.stringify(exportLottie(anim()).json), `${slug()}.json`, "application/json"));
$("expDot").onclick = () => exportWithReport("lottie", () => download(toDotLottie(exportLottie(anim()).json, slug()), `${slug()}.lottie`, "application/zip"));
$("expCss").onclick = () => exportWithReport("css", () => download(exportCss(anim(), { offsetPath: $<HTMLInputElement>("offsetPath").checked, iterations: "infinite" }).document, `${slug()}.html`, "text/html"));
$("expGif").onclick = async () => { $("expGif").textContent = "GIF…"; const bytes = await exportGif(anim(), { motionBlur: flags.blur, onProgress: (p) => ($("expGif").textContent = `GIF ${Math.round(p * 100)}%`) }); $("expGif").textContent = "GIF"; download(bytes, `${slug()}.gif`, "image/gif"); };
$("expVideo").onclick = async () => { try { $("expVideo").textContent = "WebM…"; const blob = await exportWebm(anim(), { motionBlur: flags.blur, onProgress: (p) => ($("expVideo").textContent = `WebM ${Math.round(p * 100)}%`) }); download(blob, `${slug()}.webm`, "video/webm"); } catch (e) { dialog("Video export", String((e as Error).message)); } finally { $("expVideo").textContent = "WebM"; } };

$("import").onclick = () => $("file").click();
$<HTMLInputElement>("file").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  let result: Animation | null = null;
  const notes: string[] = [];
  if (f.name.endsWith(".svg")) { const r = importSvg(await f.text()); result = r.animation; notes.push(...r.skipped.map((s) => `skipped: ${s}`)); }
  else {
    let json: unknown;
    try { json = f.name.endsWith(".lottie") ? fromDotLottie(new Uint8Array(await f.arrayBuffer())) : await f.text(); } catch (err) { dialog("Import failed", String((err as Error).message)); return; }
    const r = importLottie(json);
    result = r.animation;
    notes.push(...r.issues.map((i) => `${i.severity}: ${i.layer ? `${i.layer}: ` : ""}${i.message}`));
  }
  if (result) { history.apply(`Import ${f.name}`, result); controller.state.selection = []; selectedLayer = result.layers[0]?.id ?? null; controller.state.playhead = 0; changed(true); }
  if (notes.length || !result) dialog(result ? "Imported, with notes" : "Can't import this file", `<ul>${notes.map((n) => `<li>${n.replace(/</g, "&lt;")}</li>`).join("")}</ul><p class="hint">See 1—Documentation/v1/lottie-subset.md for what's supported.</p>`);
  (e.target as HTMLInputElement).value = "";
};

$("tabTimeline").onclick = () => { graphMode = false; $("tabTimeline").setAttribute("aria-pressed", "true"); $("tabGraph").setAttribute("aria-pressed", "false"); tl.hidden = false; $("graph").hidden = true; dirty = true; };
$("tabGraph").onclick = () => { graphMode = true; $("tabGraph").setAttribute("aria-pressed", "true"); $("tabTimeline").setAttribute("aria-pressed", "false"); tl.hidden = true; $("graph").hidden = false; dirty = true; };

// ── Keyboard ───────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input, select, textarea")) return;
  const mod = e.metaKey || e.ctrlKey, sel = controller.state.selection;
  if (e.key === " ") { e.preventDefault(); $("play").click(); }
  else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); changed(true); }
  else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); if (selectedLayer) controller.selectLayer(selectedLayer); }
  else if (mod && e.key.toLowerCase() === "c" && sel.length) clip = copyKeys(anim(), sel);
  else if (mod && e.key.toLowerCase() === "v" && clip) { history.apply("Paste keyframes", pasteKeys(anim(), clip, controller.state.playhead)); changed(true); }
  else if ((e.key === "Backspace" || e.key === "Delete") && sel.length) { history.apply("Delete keyframes", deleteKeys(anim(), sel)); controller.state.selection = []; changed(true); }
  else if (e.key.toLowerCase() === "h" && sel.length) { history.apply("Toggle hold", toggleHold(anim(), sel)); changed(true); }
  else if (e.key.toLowerCase() === "r" && sel.length > 1) { const r = reverseKeys(anim(), sel); history.apply("Reverse keyframes", r.anim); controller.state.selection = r.refs; changed(true); }
  else if (e.key.toLowerCase() === "k" && selectedLayer) {
    let next = anim();
    for (const p of Object.keys(layer()!.channels) as PropertyName[]) if ((layer()!.channels[p]?.keyframes.length ?? 0) > 1) next = addKeyAt(next, selectedLayer, p, controller.state.playhead);
    history.apply("Add keyframes", next); changed(true);
  }
  else if (e.key.toLowerCase() === "o") toggle("onion");
  else if (e.key.toLowerCase() === "p") toggle("path");
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const a = anim(); controller.state.playhead = Math.max(0, Math.min(a.duration, Math.round(controller.state.playhead * a.frameRate + (e.key === "ArrowRight" ? 1 : -1)) / a.frameRate)); dirty = true; updateInspector(); }
});

// ── Frame loop ─────────────────────────────────────────────────────────────
const theme = () => ({ bg: css("--panel"), panel: css("--panel2"), grid: css("--line"), text: css("--ink"), muted: css("--muted"), key: css("--key"), keySel: css("--accent"), accent: css("--accent"), row: css("--panel2"), line: css("--ink"), warn: css("--warn") });
let lastInspector = -1;
function frame(now: number) {
  const a = anim();
  if (playing) {
    controller.state.playhead += (now - lastTick) / 1000;
    if (controller.state.playhead > a.duration) { controller.state.playhead = 0; audio.play(0); }
    dirty = true;
  }
  lastTick = now;
  const th = theme();
  if (dirty) {
    sizePreview();
    const t = controller.state.playhead;
    if (flags.blur && !flags.onion) renderMotionBlur(pctx, scratch, a, t);
    else if (flags.onion) onion.draw(pctx, a, t, onionCfg, playing);
    else render(pctx, a, t);
    if (flags.path && layer()) drawMotionPath(pctx, a, layer()!);
    player?.goToAndStop(t * a.frameRate, true);
    const f = t * a.frameRate;
    $("time").textContent = `${t.toFixed(3)} s · f${Math.round(f)}${Math.abs(f - Math.round(f)) > 1e-6 ? "~" : ""}`;
    if (graphMode) graph.draw(th);
    else {
      const ctx = fitCanvas(tl);
      const r = tl.getBoundingClientRect();
      view.width = r.width; view.height = r.height;
      const sel = new Set(controller.state.selection.map(keyId));
      drawTimeline(ctx, a, view, { playhead: t, selected: sel, snapLine: controller.state.snapLine, marquee: controller.state.marquee, selectionRange: selectionRange(a, controller.state.selection), theme: th });
      audio.draw(ctx, view, th.accent);
    }
    if (!playing || now - lastInspector > 200) { updateInspector(); lastInspector = now; }
    dirty = playing;
  }
  seg.draw({ bg: th.panel, grid: th.grid, line: th.text, accent: th.accent, muted: th.muted, warn: th.warn });
  requestAnimationFrame(frame);
}
new ResizeObserver(() => (dirty = true)).observe(document.body);
controller.state.selection = [{ layerId: "ball", property: "position", index: 1 }];
changed(true);
requestAnimationFrame(frame);
void getKey;
