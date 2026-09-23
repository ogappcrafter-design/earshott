import { describe, expect, it } from 'vitest';
import { encodeWav, concatChunks } from '../src/audio/wav';
import { detectPitch, analyzeVoice } from '../src/audio/pitch';
import { thresholdsToEq, TEST_FREQS } from '../src/audio/hearing';
import { EQ_BANDS, EQ_PRESETS, normalizeGains, clampGain } from '../src/audio/eq';
import { decodeWavBlob, resampleLinear } from '../src/transcribe/resample';

const sine = (hz: number, sr: number, sec: number, amp = 0.5) =>
  Float32Array.from({ length: Math.floor(sr * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

describe('wav', () => {
  it('writes a valid 16-bit header and round-trips samples', async () => {
    const s = sine(440, 48000, 0.1);
    const buf = encodeWav([s], 48000, 16);
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(buf.byteLength).toBe(44 + s.length * 2);
    const back = await decodeWavBlob(new Blob([buf]));
    expect(back.samples.length).toBe(s.length);
    expect(Math.abs(back.samples[100] - s[100])).toBeLessThan(1e-3);
  });
  it('round-trips 24-bit including negatives', async () => {
    const s = Float32Array.from([0, 0.5, -0.5, 0.999, -1]);
    const back = await decodeWavBlob(new Blob([encodeWav([s], 44100, 24)]));
    s.forEach((x, i) => expect(Math.abs(back.samples[i] - x)).toBeLessThan(1e-5));
  });
  it('clips out-of-range and rejects bad input', () => {
    const v = new DataView(encodeWav([Float32Array.from([2, -2])], 8000, 16));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(() => encodeWav([], 8000)).toThrow();
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 8000)).toThrow();
  });
  it('concatenates chunks', () => {
    expect(Array.from(concatChunks([Float32Array.from([1, 2]), Float32Array.from([3])]))).toEqual([1, 2, 3]);
  });
});

describe('pitch', () => {
  for (const hz of [95, 140, 210, 320]) {
    it(`detects ${hz} Hz within 2%`, () => {
      const p = detectPitch(sine(hz, 48000, 0.05), 48000)!;
      expect(Math.abs(p - hz) / hz).toBeLessThan(0.02);
    });
  }
  it('returns null for silence', () => expect(detectPitch(new Float32Array(2048), 48000)).toBeNull());
  it('builds a voice range from a gliding tone', () => {
    const sr = 16000; const n = sr * 2; const s = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const f = 150 + 100 * (i / n); ph += (2 * Math.PI * f) / sr; s[i] = 0.5 * Math.sin(ph); }
    const v = analyzeVoice(s, sr)!;
    expect(v.lowHz).toBeGreaterThan(145); expect(v.highHz).toBeLessThan(255);
    expect(v.medianHz).toBeGreaterThan(185); expect(v.medianHz).toBeLessThan(215);
    expect(v.voicedRatio).toBeGreaterThan(0.9);
  });
  it('rejects silence as a voice sample', () => expect(analyzeVoice(new Float32Array(48000), 48000)).toBeNull());
});

describe('hearing curve', () => {
  it('gives no boost to perfect hearing', () => {
    const t = Object.fromEntries(TEST_FREQS.map((f) => [f, -70]));
    expect(thresholdsToEq(t).every((g) => g === 0)).toBe(true);
  });
  it('boosts high frequencies for typical high-frequency loss, within limits', () => {
    const eq = thresholdsToEq({ 250: -70, 500: -70, 1000: -60, 2000: -50, 4000: -30, 8000: null });
    expect(eq).toHaveLength(EQ_BANDS.length);
    expect(eq[7]).toBeGreaterThan(eq[4]);
    expect(Math.max(...eq)).toBeLessThanOrEqual(15);
    expect(Math.min(...eq)).toBeGreaterThanOrEqual(0);
  });
});

describe('eq', () => {
  it('presets all have 10 in-range bands', () => {
    for (const p of EQ_PRESETS) { expect(p.gains).toHaveLength(10); p.gains.forEach((g) => expect(clampGain(g)).toBe(g)); }
  });
  it('normalizes junk input', () => {
    expect(normalizeGains([99, -99, NaN] as number[])).toEqual([15, -15, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normalizeGains(undefined)).toHaveLength(10);
  });
});

describe('resample', () => {
  it('48k to 16k keeps length ratio and tone', () => {
    const out = resampleLinear(sine(300, 48000, 1), 48000, 16000);
    expect(out.length).toBe(16000);
    const p = detectPitch(out.subarray(2000, 4048), 16000)!;
    expect(Math.abs(p - 300)).toBeLessThan(6);
  });
});
