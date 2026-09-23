/**
 * VAD — Voice Activity Detection (energy + zero-crossing rate, main-thread class).
 * Fed by Float32Array frames from the engine's analyser; emits start/stop callbacks.
 */

export interface VADOptions {
  sampleRate?: number;
  frameMs?: number;
  sensitivity?: number;       // 0..1 — higher = trigger on quieter sounds
  minSpeechMs?: number;       // min duration before "speech" is confirmed (ms)
  silenceTimeoutMs?: number;  // silence duration before stop fires (ms)
}

export type VADPhase = 'idle' | 'detecting' | 'speech' | 'trailing';

export class VAD {
  private sr: number;
  private frameSize: number;
  private sensitivity: number;
  private minSpeechFrames: number;
  private maxTrailFrames: number;
  private phase: VADPhase = 'idle';
  private detectCount = 0;
  private trailCount = 0;

  onVoiceStart?: () => void;
  onVoiceSilence?: () => void;
  onLevel?: (level: number) => void;

  constructor(opts: VADOptions = {}) {
    this.sr         = opts.sampleRate ?? 48000;
    const fMs       = opts.frameMs ?? 20;
    this.frameSize  = Math.floor(this.sr * fMs / 1000);
    this.sensitivity = Math.max(0, Math.min(1, opts.sensitivity ?? 0.5));
    this.minSpeechFrames = Math.ceil((opts.minSpeechMs ?? 280) / fMs);
    this.maxTrailFrames  = Math.ceil((opts.silenceTimeoutMs ?? 2000) / fMs);
  }

  process(frame: Float32Array): void {
    const rms = this._rms(frame);
    const zcr = this._zcr(frame);
    this.onLevel?.(Math.min(1, rms / 0.08));

    // Adaptive threshold — higher sensitivity → lower trigger floor
    const threshold = (1 - this.sensitivity) * 0.018 + 0.0025;
    // Voice occupies 50–450 Hz, roughly 0.05–0.35 ZCR at 48 kHz
    const isVoice = rms > threshold && zcr > 0.04 && zcr < 0.40;

    switch (this.phase) {
      case 'idle':
        if (isVoice) { this.phase = 'detecting'; this.detectCount = 1; }
        break;
      case 'detecting':
        if (isVoice) {
          this.detectCount++;
          if (this.detectCount >= this.minSpeechFrames) {
            this.phase = 'speech';
            this.trailCount = 0;
            this.onVoiceStart?.();
          }
        } else { this.phase = 'idle'; this.detectCount = 0; }
        break;
      case 'speech':
        if (!isVoice) { this.phase = 'trailing'; this.trailCount = 1; }
        break;
      case 'trailing':
        if (isVoice) { this.phase = 'speech'; this.trailCount = 0; }
        else if (++this.trailCount >= this.maxTrailFrames) {
          this.phase = 'idle';
          this.onVoiceSilence?.();
        }
        break;
    }
  }

  /** Feed a chunk from the Web Audio analyser (getFloatTimeDomainData). */
  processAnalyserBuffer(buf: Float32Array): void {
    // Slice into frames
    for (let i = 0; i + this.frameSize <= buf.length; i += this.frameSize) {
      this.process(buf.subarray(i, i + this.frameSize));
    }
  }

  get active(): boolean { return this.phase === 'speech' || this.phase === 'trailing'; }
  get state(): VADPhase { return this.phase; }

  setSensitivity(s: number): void { this.sensitivity = Math.max(0, Math.min(1, s)); }
  reset(): void { this.phase = 'idle'; this.detectCount = 0; this.trailCount = 0; }

  private _rms(f: Float32Array): number {
    let s = 0;
    for (let i = 0; i < f.length; i++) s += f[i] * f[i];
    return Math.sqrt(s / f.length);
  }
  private _zcr(f: Float32Array): number {
    let c = 0;
    for (let i = 1; i < f.length; i++) if ((f[i] >= 0) !== (f[i - 1] >= 0)) c++;
    return c / f.length;
  }
}
