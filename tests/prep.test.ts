import { describe, it, expect } from 'vitest';
import { prepareForWhisper, mapTime } from '../src/transcribe/prep';
describe('whisper prep', () => {
  it('cuts long silence and maps timestamps back', () => {
    const r = 16000, a = new Float32Array(r * 20);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 0.002;
    const burst = (t: number) => { for (let i = t * r; i < (t + 1) * r; i++) a[i] += 0.3 * Math.sin(i * 0.12) * Math.sin(i * 0.0015); };
    burst(2); burst(15);
    const p = prepareForWhisper(a);
    expect(p.audio.length / r).toBeLessThan(5);
    expect(p.segments.length).toBe(2);
    expect(Math.abs(mapTime(p.segments[1].dstStart + 0.5, p.segments) - 15.2)).toBeLessThan(0.5);
  });
});
