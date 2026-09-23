import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from '../src/storage/zip';
import { GateCore } from '../src/audio/fallback';
import { makeDemoScene } from '../src/audio/demoSignal';
import { detectPitch } from '../src/audio/pitch';

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('writes a valid single-entry archive', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const z = zipFiles([{ name: 'a.wav', data }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(Array.from(z.subarray(35, 40))).toEqual([1, 2, 3, 4, 5]);
    const endAt = z.length - 22;
    expect(v.getUint32(endAt, true)).toBe(0x06054b50);
    expect(v.getUint16(endAt + 10, true)).toBe(1);
    expect(v.getUint32(v.getUint32(endAt + 16, true), true)).toBe(0x02014b50);
  });
});

describe('fallback gate', () => {
  it('matches worklet behaviour: hiss down, loud speech through', () => {
    const g = new GateCore(48000);
    const hiss = Float32Array.from({ length: 48000 }, () => (Math.random() * 2 - 1) * 0.003);
    const out = new Float32Array(hiss.length);
    g.process(hiss, out, 0.9);
    const r = (a: Float32Array) => Math.sqrt(a.subarray(-4800).reduce((s, x) => s + x * x, 0) / 4800);
    expect(r(out)).toBeLessThan(r(hiss) * 0.3);
    const talk = Float32Array.from({ length: 24000 }, (_, i) => 0.3 * Math.sin(i * 0.05));
    const out2 = new Float32Array(talk.length); g.process(talk, out2, 0.9);
    expect(r(out2) / r(talk)).toBeGreaterThan(0.85);
  });
});

describe('demo scene', () => {
  it('is normalized, non-silent, and contains a pitched talker', () => {
    const s = makeDemoScene(48000, 3);
    const peak = s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.6); expect(peak).toBeLessThanOrEqual(0.7001);
    let voiced = 0;
    for (let i = 0; i < 20; i++) if (detectPitch(s.subarray(i * 4800, i * 4800 + 2048), 48000, 60, 500, 0.3)) voiced++;
    expect(voiced).toBeGreaterThan(3);
  });
});
