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

describe('brickwall limiter', () => {
  const peakOf = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  it('never lets a huge burst exceed the ceiling (worklet)', () => {
    const L = loadProcessors()['earshot-limiter']; const l = new L();
    let maxOut = 0;
    for (let b = 0; b < 600; b++) {
      const inp = Float32Array.from({ length: 128 }, (_, i) => { const n = b * 128 + i; return (n > 20000 && n < 24000 ? 40 : 0.05) * Math.sin(n * 0.07); });
      const out = new Float32Array(128);
      l.process([[inp]], [[out]]);
      maxOut = Math.max(maxOut, peakOf(out));
    }
    expect(maxOut).toBeLessThanOrEqual(0.8911);
  });
  it('leaves quiet speech untouched apart from the tiny delay', () => {
    const L = loadProcessors()['earshot-limiter']; const l = new L();
    let energyIn = 0, energyOut = 0;
    for (let b = 0; b < 300; b++) {
      const inp = Float32Array.from({ length: 128 }, (_, i) => 0.1 * Math.sin((b * 128 + i) * 0.05));
      const out = new Float32Array(128);
      l.process([[inp]], [[out]]);
      if (b > 20) { energyIn += rms(inp); energyOut += rms(out); }
    }
    expect(energyOut / energyIn).toBeGreaterThan(0.98);
  });
  it('fallback core matches: bounded output', async () => {
    const { LimiterCore } = await import('../src/audio/fallback');
    const c = new LimiterCore(48000); const inp = Float32Array.from({ length: 20000 }, (_, i) => 12 * Math.sin(i * 0.1));
    const out = new Float32Array(inp.length); c.process(inp, out);
    expect(peakOf(out)).toBeLessThanOrEqual(0.8911);
  });
});

describe('gate does not chop soft speech', () => {
  it('keeps gain near unity through short pauses in a quiet voice', () => {
    const G = loadProcessors()['earshot-gate']; const g = new G();
    const noise = () => (Math.random() * 2 - 1) * 0.002;
    let minGainDuringSpeech = 1;
    for (let b = 0; b < 1500; b++) {
      const inp = Float32Array.from({ length: 128 }, (_, i) => {
        const n = b * 128 + i;
        if (n < 48000) return noise();
        const word = Math.floor((n - 48000) / 9600) % 2 === 0; // 200 ms speaking / 200 ms soft pause
        return noise() + (word ? 0.02 * Math.sin(n * 0.06) : 0);
      });
      const out = new Float32Array(128);
      g.process([[inp]], [[out]], { amount: [0.5] });
      if (b * 128 > 48000 + 9600) minGainDuringSpeech = Math.min(minGainDuringSpeech, g.gain);
    }
    expect(minGainDuringSpeech).toBeGreaterThan(0.9);
  });
});
