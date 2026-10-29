/**
 * GIF and video export (stretch goals §17). GIF: render each frame, quantize
 * to a 256-colour palette, encode with gifenc. Video: WebM through
 * MediaRecorder on canvas.captureStream(), driven frame by frame.
 */
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { Animation } from "../model/types.js";
import { render } from "../render/scene.js";
import { renderMotionBlur } from "../render/motionBlur.js";

export async function exportGif(anim: Animation, opts: { fps?: number; scale?: number; motionBlur?: boolean; onProgress?: (f: number) => void } = {}): Promise<Uint8Array> {
  const fps = opts.fps ?? Math.min(30, anim.frameRate), k = opts.scale ?? 0.5;
  const w = Math.round(anim.width * k), h = Math.round(anim.height * k);
  const c = new OffscreenCanvas(w, h), ctx = c.getContext("2d", { willReadFrequently: true })!;
  const full = new OffscreenCanvas(anim.width, anim.height), fctx = full.getContext("2d")!;
  const scratch = new OffscreenCanvas(anim.width, anim.height).getContext("2d")!;
  const gif = GIFEncoder();
  const frames = Math.round(anim.duration * fps);
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    if (opts.motionBlur) renderMotionBlur(fctx as unknown as CanvasRenderingContext2D, scratch as unknown as CanvasRenderingContext2D, anim, t);
    else render(fctx, anim, t);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(full, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay: Math.round(1000 / fps) });
    opts.onProgress?.((f + 1) / frames);
    if (f % 10 === 0) await new Promise((r) => setTimeout(r));
  }
  gif.finish();
  return gif.bytes();
}

export async function exportWebm(anim: Animation, opts: { motionBlur?: boolean; onProgress?: (f: number) => void } = {}): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = anim.width; c.height = anim.height;
  const ctx = c.getContext("2d")!;
  const scratch = Object.assign(document.createElement("canvas"), { width: anim.width, height: anim.height }).getContext("2d")!;
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error("this browser cannot record WebM");
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<Blob>((r) => (rec.onstop = () => r(new Blob(chunks, { type: "video/webm" }))));
  rec.start();
  const frames = Math.round(anim.duration * anim.frameRate);
  for (let f = 0; f <= frames; f++) {
    const t = f / anim.frameRate;
    if (opts.motionBlur) renderMotionBlur(ctx, scratch, anim, t); else render(ctx, anim, t);
    track.requestFrame();
    opts.onProgress?.(f / frames);
    await new Promise((r) => setTimeout(r, 1000 / anim.frameRate));
  }
  rec.stop();
  return done;
}
