import { BAND_Q, EQ_BANDS, EQ_PRESETS, normalizeGains } from './eq';
import { WORKLET_SOURCE } from './worklets';
import { concatChunks } from './wav';
import { dbToGain } from './hearing';
import { scriptCapture, scriptGate, type CaptureHandle, type GateHandle } from './fallback';
import { makeDemoScene } from './demoSignal';

/** Load the worklet module; returns false when the WebView or page policy blocks it. */
async function tryLoadWorklets(ctx: AudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return false;
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try { await ctx.audioWorklet.addModule(url); return true; } catch { return false; } finally { URL.revokeObjectURL(url); }
}

function workletGate(ctx: AudioContext): GateHandle {
  const n = new AudioWorkletNode(ctx, 'earshot-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  return { node: n, setAmount: (a) => n.parameters.get('amount')?.setValueAtTime(a, ctx.currentTime) };
}

function workletCapture(ctx: AudioContext): CaptureHandle {
  const n = new AudioWorkletNode(ctx, 'earshot-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  let cb: (c: Float32Array) => void = () => undefined;
  let stopped: (() => void) | null = null;
  n.port.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'chunk') cb(e.data.data as Float32Array);
    if (e.data?.type === 'stopped' && stopped) { const r = stopped; stopped = null; r(); }
  };
  return {
    node: n,
    start: () => n.port.postMessage('start'),
    stop: () => new Promise<void>((res) => { stopped = res; n.port.postMessage('stop'); setTimeout(() => { if (stopped) { stopped = null; res(); } }, 1500); }),
    onChunk: (fn) => { cb = fn; },
  };
}

export interface VoiceFocusTarget { lowHz: number; highHz: number; medianHz: number }

/** A sound picked on the Sources scope. Voices get the voice-focus curve; bands get a band-pass lift. */
export type LockTarget =
  | { kind: 'voice'; label: string; lowHz: number; medianHz: number; highHz: number; hue: number }
  | { kind: 'band'; label: string; lowHz: number; highHz: number; peakHz: number };

/** A sound the user muted from the scope: a cut centered on it. */
export interface MuteTarget { label: string; centerHz: number; q: number }
export const MAX_MUTES = 3;

export interface EngineSettings {
  volumeDb: number;          // 0..30 amplification
  noiseReduction: number;    // 0..1
  voiceFocus: number;        // 0..1 strength
  focusTarget: VoiceFocusTarget | null;
  balance: number;           // -1 (left) .. 1 (right)
  eq: number[];
  lock: LockTarget | null;
  mutes: MuteTarget[];
  deviceNoiseSuppression: boolean;
  limiterDb: number;         // output ceiling, dBFS
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  volumeDb: 10, noiseReduction: 0.5, voiceFocus: 0, focusTarget: null, balance: 0,
  eq: normalizeGains(EQ_PRESETS.find((p) => p.id === 'speech')?.gains), lock: null, mutes: [], deviceNoiseSuppression: true, limiterDb: -6,
};

export type EngineError = 'permission-denied' | 'no-microphone' | 'unsupported' | 'unknown';

export class EngineStartError extends Error {
  constructor(public code: EngineError, message: string) { super(message); }
}

/**
 * Live signal chain:
 * mic → rumble cut → voice focus (low cut, fundamental lift, presence lift, air cut) → 10-band EQ
 *     → noise gate → amp → limiter → balance → [monitor → speakers/headphones]
 *                                            → [capture → recording]
 *                                            → [analyser → visualizer]
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: {
    source: AudioNode; rumble: BiquadFilterNode; focusLow: BiquadFilterNode;
    focusFund: BiquadFilterNode; focusPresence: BiquadFilterNode; focusAir: BiquadFilterNode;
    eq: BiquadFilterNode[]; mutes: BiquadFilterNode[]; raw: AnalyserNode; gate: GateHandle; amp: GainNode; limiter: DynamicsCompressorNode;
    pan: StereoPannerNode; monitor: GainNode; capture: CaptureHandle; analyser: AnalyserNode;
  } | null = null;
  private settings: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS };
  private chunks: Float32Array[] = [];
  private deviceNsActive: boolean | null = null;
  private demoSource: AudioBufferSourceNode | null = null;
  /** True when running on the built-in test signal instead of the microphone. */
  demo = false;
  /** True when AudioWorklets were blocked and the ScriptProcessor path is active. */
  legacy = false;
  monitoring = false;
  recording = false;

  get running() { return this.ctx !== null && this.ctx.state !== 'closed'; }
  get sampleRate() { return this.ctx?.sampleRate ?? 48000; }
  get analyser() { return this.nodes?.analyser ?? null; }
  /** Unprocessed mic spectrum, so the Sources scope sees every sound, including ones being cut. */
  get rawAnalyser() { return this.nodes?.raw ?? null; }

  async start(settings: EngineSettings, opts: { demo?: boolean } = {}): Promise<void> {
    this.settings = { ...settings };
    if (this.running) { await this.ctx!.resume(); this.apply(); return; }
    if (opts.demo) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx; this.demo = true;
      this.legacy = !(await tryLoadWorklets(ctx));
      const scene = makeDemoScene(ctx.sampleRate);
      const b = ctx.createBuffer(1, scene.length, ctx.sampleRate); b.getChannelData(0).set(scene);
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.start();
      this.demoSource = src;
      this.build(src);
      this.apply();
      await ctx.resume();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new EngineStartError('unsupported', 'This device does not support live audio processing.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.constraints(settings.deviceNoiseSuppression) });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new EngineStartError('permission-denied', 'Microphone access is off.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new EngineStartError('no-microphone', 'No microphone was found.');
      throw new EngineStartError('unknown', (e as Error)?.message ?? 'Microphone failed to start.');
    }
    this.deviceNsActive = settings.deviceNoiseSuppression;
    let ctx: AudioContext;
    try { ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }); }
    catch { ctx = new AudioContext({ latencyHint: 'interactive' }); }
    this.ctx = ctx; this.demo = false;
    this.legacy = !(await tryLoadWorklets(ctx));
    this.build(ctx.createMediaStreamSource(this.stream));
    this.apply();
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop());
  }

  private constraints(ns: boolean): MediaTrackConstraints {
    return { echoCancellation: false, autoGainControl: false, noiseSuppression: ns, channelCount: 1, sampleRate: 48000 };
  }

  private build(source: AudioNode) {
    const ctx = this.ctx!;
    const biquad = (type: BiquadFilterType, f: number, q = 0.707) => {
      const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n;
    };
    const rumble = biquad('highpass', 70);
    const focusLow = biquad('lowshelf', 150);
    const focusFund = biquad('peaking', 180, 1.2);
    const focusPresence = biquad('peaking', 2800, 0.9);
    const focusAir = biquad('highshelf', 6500);
    const eq = EQ_BANDS.map((f, i) => {
      const t: BiquadFilterType = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      return biquad(t, f, BAND_Q);
    });
    const mutes = Array.from({ length: MAX_MUTES }, () => { const m = biquad('peaking', 1000, 4); m.gain.value = 0; return m; });
    const raw = ctx.createAnalyser();
    raw.fftSize = 8192; raw.smoothingTimeConstant = 0.35; raw.minDecibels = -120; raw.maxDecibels = -10;
    source.connect(raw);
    const gate = this.legacy ? scriptGate(ctx) : workletGate(ctx);
    const amp = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const pan = ctx.createStereoPanner();
    const monitor = ctx.createGain();
    monitor.gain.value = 0;
    const capture = this.legacy ? scriptCapture(ctx) : workletCapture(ctx);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.75;

    const chain: AudioNode[] = [source, rumble, focusLow, focusFund, focusPresence, focusAir, ...eq, ...mutes, gate.node, amp, limiter];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    limiter.connect(pan); pan.connect(monitor); monitor.connect(ctx.destination);
    limiter.connect(capture.node);
    limiter.connect(analyser);
    capture.onChunk((c) => this.chunks.push(c));
    this.nodes = { source, rumble, focusLow, focusFund, focusPresence, focusAir, eq, mutes, raw, gate, amp, limiter, pan, monitor, capture, analyser };
  }

  update(settings: EngineSettings) {
    const nsChanged = this.deviceNsActive !== null && settings.deviceNoiseSuppression !== this.deviceNsActive;
    this.settings = { ...settings };
    this.apply();
    if (nsChanged && this.stream) {
      const track = this.stream.getAudioTracks()[0];
      track?.applyConstraints(this.constraints(settings.deviceNoiseSuppression)).catch(() => undefined);
      this.deviceNsActive = settings.deviceNoiseSuppression;
    }
  }

  private apply() {
    const n = this.nodes; const ctx = this.ctx;
    if (!n || !ctx) return;
    const s = this.settings;
    const t = ctx.currentTime;
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.03);
    normalizeGains(s.eq).forEach((g, i) => ramp(n.eq[i].gain, g));
    ramp(n.amp.gain, dbToGain(Math.max(0, Math.min(30, s.volumeDb))));
    ramp(n.limiter.threshold, Math.max(-24, Math.min(0, s.limiterDb)));
    ramp(n.pan.pan, Math.max(-1, Math.min(1, s.balance)));
    n.gate.setAmount(Math.max(0, Math.min(1, s.noiseReduction)));
    const lock: LockTarget | null = s.lock
      ?? (s.focusTarget ? { kind: 'voice', label: '', hue: 0, ...s.focusTarget } : null);
    const f = lock ? Math.max(0, Math.min(1, s.voiceFocus)) : 0;
    if (lock?.kind === 'band') {
      const lo = Math.max(50, lock.lowHz), hi = Math.min(18000, Math.max(lock.highHz, lo * 1.2));
      const center = Math.sqrt(lo * hi);
      const q = Math.max(0.5, Math.min(8, center / (hi - lo)));
      ramp(n.focusLow.frequency, lo); ramp(n.focusLow.gain, -18 * f);
      ramp(n.focusFund.frequency, center); n.focusFund.Q.setTargetAtTime(q, t, 0.03); ramp(n.focusFund.gain, 8 * f);
      ramp(n.focusPresence.gain, 0);
      ramp(n.focusAir.frequency, hi); ramp(n.focusAir.gain, -18 * f);
    } else {
      const target = lock ?? { lowHz: 100, medianHz: 180, highHz: 300 };
      ramp(n.focusLow.frequency, Math.max(60, target.lowHz * 0.75));
      ramp(n.focusLow.gain, -14 * f);
      ramp(n.focusFund.frequency, target.medianHz); n.focusFund.Q.setTargetAtTime(1.2, t, 0.03);
      ramp(n.focusFund.gain, 5 * f);
      ramp(n.focusPresence.frequency, target.medianHz < 165 ? 2500 : 3100);
      ramp(n.focusPresence.gain, 7 * f);
      ramp(n.focusAir.frequency, 6500);
      ramp(n.focusAir.gain, -10 * f);
    }
    n.mutes.forEach((m, i) => {
      const mu = s.mutes?.[i];
      if (mu) { ramp(m.frequency, Math.max(40, Math.min(18000, mu.centerHz))); m.Q.setTargetAtTime(Math.max(0.7, Math.min(30, mu.q)), t, 0.03); ramp(m.gain, -24); }
      else ramp(m.gain, 0);
    });
  }

  setMonitoring(on: boolean) {
    this.monitoring = on;
    if (this.nodes && this.ctx) this.nodes.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  startRecording() {
    if (!this.nodes || this.recording) return;
    this.chunks = [];
    this.recording = true;
    this.nodes.capture.start();
  }

  async stopRecording(): Promise<Float32Array> {
    if (!this.nodes || !this.recording) return new Float32Array(0);
    this.recording = false;
    await this.nodes.capture.stop();
    const out = concatChunks(this.chunks); this.chunks = [];
    return out;
  }

  /** Output level 0..1 for meters. */
  level(): number {
    const a = this.nodes?.analyser;
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(s / buf.length) * 4);
  }

  async stop() {
    this.setMonitoring(false);
    this.recording = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.demoSource?.stop(); } catch { /* already stopped */ }
    this.demoSource = null; this.demo = false;
    this.nodes = null;
    this.deviceNsActive = null;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** Record raw mic audio (no processing) for voice enrollment. */
export async function recordRaw(seconds: number, onLevel?: (l: number) => void): Promise<{ samples: Float32Array; sampleRate: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext();
  try {
    const cap = (await tryLoadWorklets(ctx)) ? workletCapture(ctx) : scriptCapture(ctx);
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    src.connect(cap.node); src.connect(an);
    const chunks: Float32Array[] = [];
    cap.onChunk((c) => chunks.push(c));
    cap.start();
    const buf = new Float32Array(an.fftSize);
    const started = performance.now();
    await new Promise<void>((res) => {
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 5));
        if (performance.now() - started >= seconds * 1000) res(); else requestAnimationFrame(tick);
      };
      tick();
    });
    await cap.stop();
    return { samples: concatChunks(chunks), sampleRate: ctx.sampleRate };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
  }
}

/** Play a sine tone at a dBFS level, used by the hearing check. */
export async function playTone(ctx: AudioContext, freq: number, levelDb: number, seconds = 1.2, pan = 0) {
  const osc = ctx.createOscillator(); const g = ctx.createGain(); const p = ctx.createStereoPanner();
  osc.frequency.value = freq; p.pan.value = pan;
  const peak = dbToGain(levelDb); const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.08);
  g.gain.setValueAtTime(peak, t + seconds - 0.1);
  g.gain.linearRampToValueAtTime(0, t + seconds);
  osc.connect(g); g.connect(p); p.connect(ctx.destination);
  osc.start(t); osc.stop(t + seconds + 0.05);
  await new Promise((r) => setTimeout(r, seconds * 1000 + 80));
}
