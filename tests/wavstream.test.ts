import { describe, it, expect } from 'vitest';
import { encodeWav, pcmBytes, wavHeader } from '../src/audio/wav';
describe('chunked WAV', () => {
  it('header + pieces equals one-shot encode', () => {
    for (const bits of [16, 24] as const) {
      const a = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.8);
      const b = Float32Array.from({ length: 777 }, (_, i) => Math.cos(i / 5) * 0.5);
      const all = new Float32Array(1777); all.set(a); all.set(b, 1000);
      const whole = new Uint8Array(encodeWav([all], 48000, bits));
      const parts = [wavHeader(1777, 48000, bits), pcmBytes(a, bits), pcmBytes(b, bits)].map((x) => new Uint8Array(x));
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { joined.set(p, o); o += p.length; }
      expect(joined).toEqual(whole);
    }
  });
});
