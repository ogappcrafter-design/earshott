import { describe, expect, it } from 'vitest';
import { SourceTracker, hitTest, zoomView, panView, FULL_VIEW, hzToFrac, fracToHz } from '../src/audio/sources';

const SR = 48000, FFT = 8192, N = FFT / 2;
function spectrum(parts: { harmonics?: number; band?: [number, number]; level: number }[]) {
  const db = new Float32Array(N).fill(-100);
  for (let i = 0; i < N; i++) db[i] += Math.sin(i * 12.9898) * 1.5; // jitter
  const binOf = (hz: number) => Math.round((hz * FFT) / SR);
  for (const p of parts) {
    if (p.harmonics) for (let h = 1; h <= 10; h++) { const b = binOf(p.harmonics * h); if (b < N) { db[b] = -100 + p.level - h * 1.5; db[b - 1] = Math.max(db[b - 1], -100 + p.level - h * 1.5 - 6); } }
    if (p.band) for (let b = binOf(p.band[0]); b <= binOf(p.band[1]); b++) db[b] = Math.max(db[b], -100 + p.level);
  }
  return db;
}
function warm(t: SourceTracker, frames: number, make: () => Float32Array) {
  t.update(new Float32Array(N).fill(-100)); // establish the floor on silence
  let f = t.update(make()); for (let i = 1; i < frames; i++) f = t.update(make()); return f;
}

describe('source tracker', () => {
  it('separates two talkers and a noise band', () => {
    const t = new SourceTracker(SR, FFT);
    const f = warm(t, 20, () => spectrum([{ harmonics: 130, level: 40 }, { harmonics: 235, level: 36 }, { band: [2500, 4500], level: 18 }]));
    const f0s = f.voices.map((v) => v.f0).sort((a, b) => a - b);
    expect(f0s.length).toBe(2);
    expect(Math.abs(f0s[0] - 130) / 130).toBeLessThan(0.03);
    expect(Math.abs(f0s[1] - 235) / 235).toBeLessThan(0.03);
    const band = f.bands.find((b) => b.peakHz > 2400 && b.peakHz < 4700);
    expect(band).toBeDefined();
    expect(band!.lowHz).toBeLessThan(2800); expect(band!.highHz).toBeGreaterThan(4000);
  });
  it('does not invent voices from silence or pure noise', () => {
    const t = new SourceTracker(SR, FFT);
    expect(warm(t, 20, () => spectrum([{ band: [300, 6000], level: 15 }])).voices).toHaveLength(0);
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const noisy = () => { const d = spectrum([{ band: [200, 8000], level: 25 }]); for (let i = 0; i < d.length; i++) d[i] += (rnd() + rnd() + rnd() - 1.5) * 8; return d; };
    const t2 = new SourceTracker(SR, FFT); t2.sensitivity = 1;
    expect(warm(t2, 40, noisy).voices).toHaveLength(0);
  });
  it('keeps a stable id while a voice glides, and forgets it after silence', () => {
    const t = new SourceTracker(SR, FFT);
    let f0 = 150; const f = warm(t, 30, () => spectrum([{ harmonics: (f0 *= 1.004), level: 40 }]));
    expect(f.voices).toHaveLength(1);
    const id = f.voices[0].id;
    expect(f.voices[0].highHz).toBeGreaterThan(f.voices[0].lowHz);
    let g = t.update(spectrum([{ harmonics: f0, level: 40 }]));
    expect(g.voices[0].id).toBe(id);
    for (let i = 0; i < 60; i++) g = t.update(spectrum([]));
    expect(g.voices).toHaveLength(0);
  });
  it('sensitivity lets quieter voices through', () => {
    const quiet = () => spectrum([{ harmonics: 180, level: 14 }]);
    const lo = new SourceTracker(SR, FFT); lo.sensitivity = 0;
    const hi = new SourceTracker(SR, FFT); hi.sensitivity = 1;
    expect(warm(lo, 15, quiet).voices).toHaveLength(0);
    expect(warm(hi, 15, quiet).voices).toHaveLength(1);
  });
});

describe('wobbly voice', () => {
  it('a voice with vibrato stays one source', () => {
    const t = new SourceTracker(SR, FFT); let k = 0;
    const f = warm(t, 60, () => spectrum([{ harmonics: 130 * (1 + 0.05 * Math.sin((k++) / 3)), level: 40 }]));
    expect(f.voices).toHaveLength(1);
  });
});

describe('hit test', () => {
  const frame = {
    voices: [{ kind: 'voice' as const, id: 'v', label: 'Voice A', f0: 200, lowHz: 180, highHz: 220, medianHz: 200, strength: 1, hue: 0, history: [] }],
    bands: [{ kind: 'band' as const, id: 'b', label: 'Sound 1', lowHz: 2000, highHz: 4000, peakHz: 3000, level: 10 }],
  };
  it('prefers a voice harmonic, falls back to bands, else null', () => {
    expect(hitTest(frame, 605)?.id).toBe('v');
    expect(hitTest(frame, 3000)?.id).toBe('b');
    expect(hitTest(frame, 9000)).toBeNull();
  });
});

describe('zoom and pan', () => {
  it('zooms around the focal point and clamps to limits', () => {
    const z = zoomView(FULL_VIEW, 1000, 4);
    expect(z.maxHz / z.minHz).toBeCloseTo(Math.pow(400, 0.25), 3);
    expect(Math.abs(hzToFrac(1000, z) - hzToFrac(1000, FULL_VIEW))).toBeLessThan(1e-6);
    const max = zoomView(z, 1000, 1000);
    expect(max.maxHz / max.minHz).toBeCloseTo(1.414, 2);
    const out = zoomView(z, 1000, 0.0001);
    expect(out.minHz).toBeCloseTo(40); expect(out.maxHz).toBeCloseTo(16000);
  });
  it('pans without leaving the range, and frac/hz invert', () => {
    const z = zoomView(FULL_VIEW, 200, 3);
    const p = panView(z, -5); expect(p.minHz).toBeCloseTo(40);
    expect(fracToHz(hzToFrac(777, z), z)).toBeCloseTo(777, 3);
  });
});
