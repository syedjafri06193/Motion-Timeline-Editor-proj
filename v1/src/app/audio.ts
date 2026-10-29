/**
 * Audio waveform track (stretch goal §17): decode an audio file, draw its
 * peaks along the timeline, and play it in sync with the preview.
 */
import { timeToX, type TimelineView } from "../timeline/view.js";

export class AudioTrack {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private peaks: Float32Array | null = null; // max |sample| per 1/200 s
  name = "";

  get loaded(): boolean { return !!this.buffer; }

  async load(file: File): Promise<void> {
    this.ctx ??= new AudioContext();
    this.buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this.name = file.name;
    const rate = 200, ch = this.buffer.getChannelData(0), per = Math.max(1, Math.floor(this.buffer.sampleRate / rate));
    this.peaks = new Float32Array(Math.ceil(ch.length / per));
    for (let i = 0; i < this.peaks.length; i++) { let m = 0; for (let j = i * per; j < Math.min(ch.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(ch[j]!)); this.peaks[i] = m; }
  }

  play(at: number): void {
    if (!this.ctx || !this.buffer) return;
    this.stop();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.ctx.destination);
    void this.ctx.resume();
    if (at < this.buffer.duration) this.source.start(0, at);
  }

  stop(): void { try { this.source?.stop(); } catch { /* not started */ } this.source = null; }

  /** Draw the waveform in a strip just under the ruler. */
  draw(ctx: CanvasRenderingContext2D, view: TimelineView, color: string): void {
    if (!this.peaks) return;
    const y0 = view.headerHeight - 2, h = 14;
    ctx.save();
    ctx.fillStyle = color; ctx.globalAlpha = 0.45;
    for (let x = view.labelWidth; x < view.width; x++) {
      const t = view.scrollX + (x - view.labelWidth) / view.pxPerSecond;
      const i = Math.floor(t * 200);
      if (i < 0 || i >= this.peaks.length) continue;
      const v = this.peaks[i]! * h;
      ctx.fillRect(x, y0 - v, 1, v);
    }
    ctx.restore();
    void timeToX;
  }
}
