/**
 * Same gate + capture algorithms as the AudioWorklets, running on ScriptProcessorNode.
 * Used when a WebView or page policy blocks AudioWorklet modules (older Android System WebView,
 * strict content-security policies). Slightly more latency, identical sound.
 */
export class GateCore {
  env = 0; floor = 0.002; gain = 1;
  private attack: number; private release: number; private floorUp: number; private floorDown: number;
  constructor(sampleRate: number) {
    this.attack = Math.exp(-1 / (0.003 * sampleRate));
    this.release = Math.exp(-1 / (0.08 * sampleRate));
    this.floorUp = Math.exp(-1 / (20 * sampleRate));
    this.floorDown = Math.exp(-1 / (0.4 * sampleRate));
    this.holdLen = Math.floor(0.3 * sampleRate);
    this.closeC = Math.exp(-1 / (0.12 * sampleRate));
    this.openC = Math.exp(-1 / (0.002 * sampleRate));
  }
  private hold = 0; private holdLen: number; private closeC: number; private openC: number;
  process(input: Float32Array, output: Float32Array, amount: number) {
    for (let i = 0; i < input.length; i++) {
      const peak = Math.abs(input[i]);
      const coef = peak > this.env ? this.attack : this.release;
      this.env = coef * this.env + (1 - coef) * peak;
      const fc = this.env > this.floor ? this.floorUp : this.floorDown;
      this.floor = Math.max(1e-5, fc * this.floor + (1 - fc) * this.env);
      const openAt = this.floor * (1.5 + amount * 2.5);
      let target = 1;
      if (this.env >= openAt) this.hold = this.holdLen;
      else if (this.hold > 0) this.hold--;
      else {
        target = Math.pow(Math.max(0, this.env / openAt), 1 + amount * 2);
        target = Math.max(target, 1 - amount * 0.85);
      }
      const gc = target < this.gain ? this.closeC : this.openC;
      this.gain = gc * this.gain + (1 - gc) * target;
      output[i] = input[i] * this.gain;
    }
  }
}

/** Brickwall lookahead limiter (same maths as the worklet). Output never exceeds `ceil`. */
export class LimiterCore {
  private D: number; private dly: Float32Array; private req: Float32Array; private mr: Float32Array;
  private p = 0; private sum: number; private g = 1; private rel: number; ceil = 0.891;
  constructor(sampleRate: number) {
    this.D = Math.max(8, Math.round(0.003 * sampleRate));
    this.dly = new Float32Array(this.D); this.req = new Float32Array(this.D).fill(1); this.mr = new Float32Array(this.D).fill(1);
    this.sum = this.D; this.rel = 1 / (0.15 * sampleRate);
  }
  process(input: Float32Array, output: Float32Array) {
    const D = this.D;
    for (let i = 0; i < input.length; i++) {
      const x = input[i], a = Math.abs(x), p = this.p;
      this.dly[p] = x; this.req[p] = a > this.ceil ? this.ceil / a : 1;
      let m = 1; for (let k = 0; k < D; k++) { const r = this.req[k]; if (r < m) m = r; }
      this.sum += m - this.mr[p]; this.mr[p] = m;
      const avg = this.sum / D, up = this.g + this.rel;
      this.g = avg < up ? avg : up;
      let y = this.dly[(p + 1) % D] * this.g;
      if (y > this.ceil) y = this.ceil; else if (y < -this.ceil) y = -this.ceil;
      output[i] = y; this.p = (p + 1) % D;
    }
  }
}
export function scriptLimiter(ctx: AudioContext): AudioNode {
  const sp = ctx.createScriptProcessor(1024, 1, 1);
  const core = new LimiterCore(ctx.sampleRate);
  sp.onaudioprocess = (e) => core.process(e.inputBuffer.getChannelData(0), e.outputBuffer.getChannelData(0));
  return sp;
}

export interface GateHandle { node: AudioNode; setAmount: (a: number) => void }
export interface CaptureHandle { node: AudioNode; start: () => void; stop: () => Promise<void>; onChunk: (fn: (c: Float32Array) => void) => void }

export function scriptGate(ctx: AudioContext): GateHandle {
  const sp = ctx.createScriptProcessor(1024, 1, 1);
  const core = new GateCore(ctx.sampleRate);
  let amount = 0.5;
  sp.onaudioprocess = (e) => core.process(e.inputBuffer.getChannelData(0), e.outputBuffer.getChannelData(0), amount);
  return { node: sp, setAmount: (a) => { amount = a; } };
}

export function scriptCapture(ctx: AudioContext): CaptureHandle {
  const sp = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain(); sink.gain.value = 0;
  sp.connect(sink); sink.connect(ctx.destination); // ScriptProcessor only runs when connected to output
  let rec = false; let cb: (c: Float32Array) => void = () => undefined;
  sp.onaudioprocess = (e) => { if (rec) cb(e.inputBuffer.getChannelData(0).slice()); };
  return {
    node: sp,
    start: () => { rec = true; },
    stop: async () => { rec = false; },
    onChunk: (fn) => { cb = fn; },
  };
}
