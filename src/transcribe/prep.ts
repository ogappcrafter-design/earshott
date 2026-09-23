import { SpectralCore } from '../audio/spectral';

/** A kept stretch of the original audio: [srcStart, srcEnd) seconds, placed at dstStart in the compacted clip. */
export type Segment = { srcStart: number; srcEnd: number; dstStart: number };

/**
 * Get 16 kHz audio ready for Whisper:
 *  1. strip steady background noise (Whisper hallucinates on hiss),
 *  2. level it so faint speech sits at a healthy volume,
 *  3. cut long silences out so the model only works on sound.
 * Returns the compacted clip plus a map to translate timestamps back to the original recording.
 */
export function prepareForWhisper(audio: Float32Array, rate = 16000): { audio: Float32Array; segments: Segment[] } {
  const clean = audio.length > rate ? SpectralCore.clean(audio, rate, 0.6, 512) : audio.slice();

  // 1st-order high-pass ~80 Hz: removes rumble that wastes model attention
  const a = Math.exp((-2 * Math.PI * 80) / rate);
  let px = 0, py = 0;
  for (let i = 0; i < clean.length; i++) { const x = clean[i]; py = a * (py + x - px); px = x; clean[i] = py; }

  // frame energy (30 ms)
  const hop = Math.round(rate * 0.03);
  const nF = Math.floor(clean.length / hop);
  if (nF < 4) return { audio: normalize(clean), segments: [{ srcStart: 0, srcEnd: clean.length / rate, dstStart: 0 }] };
  const db = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += clean[i] * clean[i];
    db[f] = 10 * Math.log10(s / hop + 1e-12);
  }
  const sorted = Array.from(db).sort((x, y) => x - y);
  const floor = sorted[Math.floor(nF * 0.15)], peak = sorted[Math.floor(nF * 0.98)];
  const thr = Math.max(floor + 6, floor + (peak - floor) * 0.18);

  // mark active frames, pad 300 ms either side, bridge gaps under 0.8 s
  const pad = Math.round(0.3 / 0.03), bridge = Math.round(0.8 / 0.03);
  const act = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) if (db[f] > thr) for (let k = Math.max(0, f - pad); k <= Math.min(nF - 1, f + pad); k++) act[k] = 1;
  let gap = 0;
  for (let f = 0; f < nF; f++) {
    if (act[f]) { if (gap && gap < bridge && f - gap > 0) act.fill(1, f - gap, f); gap = 0; } else gap++;
  }

  const runs: [number, number][] = [];
  for (let f = 0; f < nF; ) { if (!act[f]) { f++; continue; } const s = f; while (f < nF && act[f]) f++; runs.push([s * hop, f * hop]); }
  if (!runs.length) return { audio: new Float32Array(0), segments: [] };

  const spacer = Math.round(rate * 0.4); // short silence between kept pieces so sentences don't smear together
  const total = runs.reduce((n, [s, e]) => n + (e - s), 0) + spacer * (runs.length - 1);
  const out = new Float32Array(total);
  const segments: Segment[] = [];
  let w = 0;
  runs.forEach(([s, e], i) => {
    out.set(clean.subarray(s, e), w);
    segments.push({ srcStart: s / rate, srcEnd: e / rate, dstStart: w / rate });
    w += e - s + (i < runs.length - 1 ? spacer : 0);
  });
  return { audio: normalize(out), segments };
}

/** Translate a time in the compacted clip back to the original recording. */
export function mapTime(t: number, segs: Segment[]): number {
  if (!segs.length) return t;
  for (let i = segs.length - 1; i >= 0; i--) {
    const g = segs[i];
    if (t >= g.dstStart) return Math.min(g.srcEnd, g.srcStart + (t - g.dstStart));
  }
  return segs[0].srcStart;
}

function normalize(x: Float32Array): Float32Array {
  let pk = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
  if (pk < 1e-6) return x;
  const g = Math.min(0.9 / pk, 40);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}
