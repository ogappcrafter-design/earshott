import { describe, expect, it } from 'vitest';
import { WORKLET_SOURCE } from '../src/audio/worklets';

function loadProcessors() {
  const reg: Record<string, any> = {};
  class AudioWorkletProcessor { port = { onmessage: null as any, sent: [] as any[], postMessage(m: any) { this.sent.push(m); } }; }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', WORKLET_SOURCE)(
    AudioWorkletProcessor, (n: string, c: any) => { reg[n] = c; }, 48000);
  return reg;
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

function runGate(amount: number, signal: (i: number) => number, blocks = 400) {
  const G = loadProcessors()['earshot-gate']; const g = new G();
  let last = new Float32Array(128); let lastIn = new Float32Array(128);
  for (let b = 0; b < blocks; b++) {
    const inp = Float32Array.from({ length: 128 }, (_, i) => signal(b * 128 + i));
    const out = new Float32Array(128);
    g.process([[inp]], [[out]], { amount: [amount] });
    last = out; lastIn = inp;
  }
  return { out: rms(last), in: rms(lastIn) };
}

describe('gate worklet', () => {
  const noise = () => (Math.random() * 2 - 1) * 0.003;
  it('pulls steady background hiss down when strength is high', () => {
    const r = runGate(0.9, noise);
    expect(r.out).toBeLessThan(r.in * 0.3);
  });
  it('passes through untouched at zero strength', () => {
    const r = runGate(0, noise);
    expect(r.out / r.in).toBeGreaterThan(0.9);
  });
  it('lets a loud voice through after background noise', () => {
    const r = runGate(0.9, (i) => (i < 48000 * 0.8 ? noise() : 0.3 * Math.sin(i * 0.05)), 500);
    expect(r.out / r.in).toBeGreaterThan(0.85);
  });
});

describe('capture worklet', () => {
  it('only captures while recording and flushes on stop', () => {
    const C = loadProcessors()['earshot-capture']; const c = new C();
    const blk = [Float32Array.from({ length: 128 }, () => 0.25), Float32Array.from({ length: 128 }, () => 0.75)];
    c.process([blk]);
    expect(c.port.sent).toHaveLength(0);
    c.port.onmessage({ data: 'start' });
    for (let i = 0; i < 40; i++) c.process([blk]);
    c.port.onmessage({ data: 'stop' });
    const chunks = c.port.sent.filter((m: any) => m.type === 'chunk');
    const total = chunks.reduce((n: number, m: any) => n + m.data.length, 0);
    expect(total).toBe(40 * 128);
    expect(chunks[0].data[0]).toBeCloseTo(0.5);
    expect(c.port.sent.at(-1).type).toBe('stopped');
  });
});
