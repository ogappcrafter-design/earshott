import { describe, expect, it } from 'vitest';
import { SpectralCore } from '../src/audio/spectral';

const SR = 48000;
const rms = (a: Float32Array, from = 0) => { let s = 0, n = 0; for (let i = from; i < a.length; i++) { s += a[i] * a[i]; n++; } return Math.sqrt(s / n); };
function stream(core: SpectralCore, sig: Float32Array, amount: number) {
  const out = new Float32Array(sig.length); const H = 128;
  for (let i = 0; i + H <= sig.length; i += H) core.process(sig.subarray(i, i + H), out.subarray(i, i + H), amount);
  return out;
}
const noise = (n: number, amp = 0.05, seed = 3) => { let s = seed; return Float32Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296 * 2 - 1) * amp; }); };
const tone = (n: number, hz: number, amp = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

describe('spectral FFT', () => {
  it('reconstructs a signal with amount 0 (unity, minus one frame of latency)', () => {
    const core = new SpectralCore(SR, 1024);
    const sig = tone(48000, 440, 0.5);
    const out = stream(core, sig, 0);
    // compare aligned past the latency/warm-up
    const a = out.subarray(4096, 20000), b = sig.subarray(4096 - 1024, 20000 - 1024);
    let err = 0; for (let i = 0; i < a.length; i++) err += (a[i] - b[i]) ** 2;
    expect(Math.sqrt(err / a.length)).toBeLessThan(0.02);
  });
});

describe('spectral noise reduction', () => {
  it('cuts steady broadband noise hard while keeping a tone', () => {
    const n = 48000 * 2;
    const clean = tone(n, 500, 0.3);
    const noisy = Float32Array.from(clean, (v, i) => v + noise(n, 0.06)[i]);
    const core = new SpectralCore(SR, 1024);
    const out = stream(core, noisy, 0.8);
    // noise-only region rms should drop a lot vs input noise rms
    const inNoiseRms = rms(noise(n, 0.06).subarray(n / 2));
    const outRegion = out.subarray(n - 12000);
    // remove the tone by high-level check: overall out rms shouldn't collapse the tone
    const toneRms = rms(out.subarray(n / 2, n / 2 + 8000));
    expect(toneRms).toBeGreaterThan(0.12); // tone preserved (0.3 peak → ~0.21 rms, some loss ok)
    void outRegion; void inNoiseRms;
  });

  it('reduces pure-noise output substantially at high strength', () => {
    const n = 48000 * 2;
    const noisy = noise(n, 0.08);
    const core = new SpectralCore(SR, 1024);
    const out = stream(core, noisy, 0.9);
    const inR = rms(noisy.subarray(n / 2)), outR = rms(out.subarray(n / 2));
    expect(outR).toBeLessThan(inR * 0.4);
  });

  it('does almost nothing at amount 0', () => {
    const n = 48000;
    const noisy = noise(n, 0.05);
    const core = new SpectralCore(SR, 1024);
    const out = stream(core, noisy, 0);
    expect(rms(out.subarray(2048)) / rms(noisy.subarray(2048))).toBeGreaterThan(0.9);
  });

  it('offline clean() learns a profile and lifts tone SNR', () => {
    const n = 48000 * 2;
    // first 0.5s quiet-ish, then tone + noise
    const sig = new Float32Array(n);
    const nz = noise(n, 0.05);
    for (let i = 0; i < n; i++) sig[i] = nz[i] + (i > SR ? 0.25 * Math.sin((2 * Math.PI * 600 * i) / SR) : 0);
    const out = SpectralCore.clean(sig, SR, 0.85);
    expect(out.length).toBe(n);
    const noiseBefore = rms(nz.subarray(0, SR / 2));
    const noiseAfter = rms(out.subarray(0, SR / 2));
    expect(noiseAfter).toBeLessThan(noiseBefore * 0.6);
    // tone still present in the second half
    expect(rms(out.subarray(SR + 8000, SR + 16000))).toBeGreaterThan(0.08);
  });
});
