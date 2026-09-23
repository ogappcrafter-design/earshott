/**
 * SpectralCore: streaming STFT noise reduction — the "extract minimal sounds" engine.
 *
 * Forensic-grade approach (CEDAR DNS / Ephraim-Malah lineage):
 *  - overlap-add STFT (Hann analysis + synthesis, 75% overlap, exact reconstruction)
 *  - per-bin noise estimate by minimum statistics, or a frozen profile learned from the room
 *  - decision-directed a-priori SNR → Wiener gain with over-subtraction and a spectral floor,
 *    which suppresses steady background (fans, hiss, engines, HVAC) while leaving speech intact
 *    and avoiding the "musical noise" that naive spectral subtraction produces.
 *
 * Fully self-contained (its own FFT as static methods, no imports) so it can be BOTH
 * unit-tested directly AND embedded into an AudioWorklet via SpectralCore.toString().
 */
export class SpectralCore {
  N: number; hop: number;
  private win: Float32Array;
  private rev: Uint32Array;
  private cos: Float32Array; private sin: Float32Array;
  private inBuf: Float32Array; private outBuf: Float32Array;
  private re: Float32Array; private im: Float32Array;
  private noise: Float32Array; private prevGain: Float32Array; private prevPower: Float32Array;
  private learnAcc: Float32Array; private learnCount = 0;
  private inTmp: Float32Array; private inCount = 0;
  private outRing: Float32Array; private outHead = 0; private outTail = 0; private outAvail = 0;
  private framesSeen = 0;
  private cola: number;

  constructor(sampleRate: number, fftSize = 1024) {
    void sampleRate;
    const N = fftSize; this.N = N; this.hop = N >> 2;
    this.win = new Float32Array(N);
    for (let n = 0; n < N; n++) this.win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
    // COLA constant for Hann analysis+synthesis at 75% overlap = 1.5
    this.cola = 1.5;
    // bit-reversal
    this.rev = new Uint32Array(N);
    let bits = 0; while ((1 << bits) < N) bits++;
    for (let i = 0; i < N; i++) { let x = i, r = 0; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } this.rev[i] = r >>> 0; }
    this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) { this.cos[k] = Math.cos((-2 * Math.PI * k) / N); this.sin[k] = Math.sin((-2 * Math.PI * k) / N); }
    this.inBuf = new Float32Array(N); this.outBuf = new Float32Array(N);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    const half = N / 2 + 1;
    this.noise = new Float32Array(half).fill(1e-6);
    this.prevGain = new Float32Array(half).fill(1);
    this.prevPower = new Float32Array(half);
    this.learnAcc = new Float32Array(half);
    this.inTmp = new Float32Array(this.hop);
    this.outRing = new Float32Array(N * 2);
  }

  /** in-place iterative radix-2 FFT (inverse when inv=true). */
  private fft(re: Float32Array, im: Float32Array, inv: boolean) {
    const N = this.N, rev = this.rev;
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1, step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0, idx = 0; k < half; k++, idx += step) {
          let wr = this.cos[idx], wi = this.sin[idx];
          if (inv) wi = -wi;
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inv) { const s = 1 / N; for (let i = 0; i < N; i++) { re[i] *= s; im[i] *= s; } }
  }

  /** Begin/continue learning the room's noise fingerprint from the frames passing through. */
  startLearn() { this.learnAcc.fill(0); this.learnCount = 0; }
  finishLearn() {
    if (this.learnCount > 0) for (let k = 0; k < this.noise.length; k++) this.noise[k] = Math.max(1e-7, this.learnAcc[k] / this.learnCount);
    this.learnCount = 0;
  }

  private frame(amount: number, learning: boolean) {
    const N = this.N, H = this.hop, half = N / 2;
    this.inBuf.copyWithin(0, H); this.inBuf.set(this.inTmp, N - H);
    for (let n = 0; n < N; n++) { this.re[n] = this.inBuf[n] * this.win[n]; this.im[n] = 0; }
    this.fft(this.re, this.im, false);
    const over = 1 + amount * 4;              // over-subtraction grows with strength
    const floor = Math.pow(10, (-6 - amount * 22) / 20); // spectral floor: -6 dB (gentle) → -28 dB (aggressive)
    const alpha = 0.98;
    this.framesSeen++;
    for (let k = 0; k <= half; k++) {
      const power = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      if (learning) { this.learnAcc[k] += power; }
      else {
        // minimum-statistics noise tracking: follow downward fast, drift upward slowly
        if (power < this.noise[k]) this.noise[k] = 0.9 * this.noise[k] + 0.1 * power;
        else this.noise[k] = 0.995 * this.noise[k] + 0.005 * power;
      }
      const noiseP = this.noise[k] * over + 1e-10;
      const postSNR = power / noiseP;
      const priori = alpha * (this.prevGain[k] * this.prevGain[k] * this.prevPower[k] / noiseP) + (1 - alpha) * Math.max(postSNR - 1, 0);
      let gain = priori / (priori + 1);       // Wiener gain from a-priori SNR
      if (gain < floor) gain = floor;
      this.prevGain[k] = gain; this.prevPower[k] = power;
      this.re[k] *= gain; this.im[k] *= gain;
      if (k > 0 && k < half) { this.re[N - k] = this.re[k]; this.im[N - k] = -this.im[k]; }
    }
    if (learning) this.learnCount++;
    this.fft(this.re, this.im, true);
    const g = 1 / this.cola;
    for (let n = 0; n < N; n++) this.outBuf[n] += this.re[n] * this.win[n] * g;
    // emit hop samples, then slide the accumulator
    for (let n = 0; n < H; n++) { this.outRing[this.outTail] = this.outBuf[n]; this.outTail = (this.outTail + 1) % this.outRing.length; this.outAvail++; }
    this.outBuf.copyWithin(0, H); this.outBuf.fill(0, N - H);
  }

  /** Streaming: consumes `input`, writes the same number of processed samples to `output`. */
  process(input: Float32Array, output: Float32Array, amount: number, learning = false) {
    for (let i = 0; i < input.length; i++) {
      this.inTmp[this.inCount++] = input[i];
      if (this.inCount === this.hop) { this.frame(amount, learning); this.inCount = 0; }
      // one frame (N samples) of latency before output is available
      if (this.outAvail > 0 && this.framesSeen > 1) { output[i] = this.outRing[this.outHead]; this.outHead = (this.outHead + 1) % this.outRing.length; this.outAvail--; }
      else output[i] = 0;
    }
  }

  /** Offline one-shot clean: learn from the quietest stretch, then process the whole buffer. */
  static clean(samples: Float32Array, sampleRate: number, amount: number, fftSize = 1024): Float32Array {
    const core = new SpectralCore(sampleRate, fftSize);
    // learn from the quietest 0.5 s window
    const win = Math.min(samples.length, Math.floor(sampleRate * 0.5));
    let quietStart = 0, quietE = Infinity;
    for (let s = 0; s + win <= samples.length; s += win) {
      let e = 0; for (let i = s; i < s + win; i++) e += samples[i] * samples[i];
      if (e < quietE) { quietE = e; quietStart = s; }
    }
    core.startLearn();
    const scratch = new Float32Array(core.hop);
    for (let s = quietStart; s + core.hop <= quietStart + win; s += core.hop) core.process(samples.subarray(s, s + core.hop), scratch, amount, true);
    core.finishLearn();
    // reset streaming state but keep the learned noise profile
    core.inCount = 0; core.outHead = core.outTail = core.outAvail = 0; core.framesSeen = 0;
    core.inBuf.fill(0); core.outBuf.fill(0); core.prevGain.fill(1); core.prevPower.fill(0);
    const out = new Float32Array(samples.length);
    const latency = core.N;
    const padded = new Float32Array(samples.length + latency);
    padded.set(samples);
    const tmp = new Float32Array(padded.length);
    core.process(padded, tmp, amount, false);
    out.set(tmp.subarray(latency, latency + samples.length));
    return out;
  }
}
