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
    this.floorUp = Math.exp(-1 / (4 * sampleRate));
    this.floorDown = Math.exp(-1 / (0.4 * sampleRate));
  }
  process(input: Float32Array, output: Float32Array, amount: number) {
    for (let i = 0; i < input.length; i++) {
      const peak = Math.abs(input[i]);
      const coef = peak > this.env ? this.attack : this.release;
      this.env = coef * this.env + (1 - coef) * peak;
      const fc = this.env > this.floor ? this.floorUp : this.floorDown;
      this.floor = Math.max(1e-5, fc * this.floor + (1 - fc) * this.env);
      const openAt = this.floor * (2 + amount * 4);
      let target = 1;
      if (this.env < openAt) {
        target = Math.pow(Math.max(0, this.env / openAt), 1 + amount * 3);
        target = Math.max(target, 1 - amount * 0.97);
      }
      const gc = target < this.gain ? 0.995 : 0.9;
      this.gain = gc * this.gain + (1 - gc) * target;
      output[i] = input[i] * this.gain;
    }
  }
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
