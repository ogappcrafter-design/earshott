/**
 * Live sound-source finder for the Sources scope.
 * Every frame it takes an FFT (in dB) and returns:
 *  - voices: harmonic pitch tracks (a person talking, singing, a dog, a whistle), tracked over time
 *  - bands: regions of the spectrum holding steady energy (fans, traffic, hum, music, crowd), split at valleys
 * Pure math, no Web Audio, so it is fully unit-tested.
 */

export const SCOPE_MIN_HZ = 40;
export const SCOPE_MAX_HZ = 16000;
const GRID = 120; // log-spaced analysis points for band finding

export interface VoiceSource {
  kind: 'voice'; id: string; label: string;
  f0: number; lowHz: number; highHz: number; medianHz: number;
  strength: number; hue: number; history: (number | null)[];
}
export interface BandSource {
  kind: 'band'; id: string; label: string;
  lowHz: number; highHz: number; peakHz: number; level: number;
}
export type Source = VoiceSource | BandSource;
export interface SourceFrame { voices: VoiceSource[]; bands: BandSource[]; excess: Float32Array }

export const gridHz = (i: number) => SCOPE_MIN_HZ * Math.pow(SCOPE_MAX_HZ / SCOPE_MIN_HZ, i / (GRID - 1));

interface Track { id: string; f0: number; hits: number; missed: number; history: (number | null)[]; strength: number; hue: number; conf: number }

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HISTORY = 160;

export class SourceTracker {
  private ref: number | null = null;
  private longTerm = new Float32Array(GRID);
  private tracks: Track[] = [];
  private nextId = 0;
  /** 0..1 — higher finds quieter sources. */
  sensitivity = 0.7;

  constructor(private sampleRate: number, private fftSize: number) {}

  private bin(hz: number) { return Math.round((hz * this.fftSize) / this.sampleRate); }

  /**
   * Two views of the spectrum:
   *  - level: dB above the room's quiet floor (one auto-tracked number), used for the map and for bands,
   *    so steady sounds like fans stay visible instead of being "learned away"
   *  - peaks: dB above the local spectral neighbourhood, used for pitch, so harmonics pop out of any background
   */
  update(db: Float32Array): SourceFrame {
    const n = db.length;
    const top = Math.min(n - 1, this.bin(SCOPE_MAX_HZ)), bottom = Math.max(1, this.bin(SCOPE_MIN_HZ));
    const clean = new Float32Array(n);
    for (let i = 0; i < n; i++) clean[i] = Number.isFinite(db[i]) ? Math.max(-160, db[i]) : -160;
    // room floor = 15th percentile of this frame's spectrum, smoothed over time (falls fast, rises slow)
    const sample: number[] = [];
    for (let i = bottom; i <= top; i += 4) sample.push(clean[i]);
    sample.sort((a, b) => a - b);
    const p15 = sample[Math.floor(sample.length * 0.15)] ?? -120;
    this.ref = this.ref === null ? p15 : p15 < this.ref ? this.ref * 0.7 + p15 * 0.3 : this.ref * 0.97 + p15 * 0.03;
    const excess = new Float32Array(n);
    for (let i = 0; i < n; i++) excess[i] = Math.max(0, clean[i] - this.ref);
    // local-contrast spectrum for harmonics: subtract a ±W-bin running mean
    const W = 10;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + clean[i];
    const peaks = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) {
      const a = Math.max(0, i - W), b = Math.min(n, i + W + 1);
      peaks[i] = Math.max(0, clean[i] - (prefix[b] - prefix[a]) / (b - a));
      if (excess[i] < 6) peaks[i] = 0; // ignore contrast inside the quiet floor
    }
    const voices = this.findVoices(peaks);
    // bands use the smooth envelope only (narrow peaks removed), so a voice's harmonics don't chop the map into slivers
    const envelope = new Float32Array(n);
    for (let i = 0; i < n; i++) envelope[i] = Math.max(0, excess[i] - peaks[i]);
    const bands = this.findBands(envelope);
    return { voices, bands, excess };
  }

  private at(excess: Float32Array, hz: number) {
    const b = this.bin(hz);
    if (b < 1 || b >= excess.length - 1) return 0;
    return Math.max(excess[b - 1], excess[b], excess[b + 1]);
  }

  private findVoices(excess: Float32Array): VoiceSource[] {
    const threshold = 55 - this.sensitivity * 35; // summed harmonic contrast in dB
    // Iterative estimate-and-cancel: find the strongest pitch, erase its harmonics, repeat.
    // This stops one voice's harmonics from creating ghost voices at 3/2 or 2/3 of its pitch.
    const work = excess.slice();
    const picked: { f0: number; sal: number }[] = [];
    for (let round = 0; round < 3; round++) {
      let bestF = 0, bestS = 0;
      for (let f = 70; f <= 420; f *= 1.012) {
        let s = 0, anti = 0, found = 0;
        for (let h = 1; h <= 8; h++) {
          const hz = f * h; if (hz > 5000) break;
          const e = this.at(work, hz);
          if (e > 4) found++;
          s += e / Math.sqrt(h);
          anti += this.at(work, f * (h + 0.5)) / Math.sqrt(h);
        }
        const score = found >= 4 && s > anti * 1.6 ? s - anti * 0.8 : 0;
        if (score > bestS) { bestS = score; bestF = f; }
      }
      if (bestS <= threshold) break;
      picked.push({ f0: bestF, sal: bestS });
      for (let h = 1; h <= 40; h++) {
        const b = this.bin(bestF * h); if (b >= work.length) break;
        for (let k = -2; k <= 2; k++) if (b + k >= 0 && b + k < work.length) work[b + k] = 0;
      }
    }
    // associate with tracks
    const used = new Set<Track>();
    for (const c of picked) {
      let best: Track | null = null; let bestD = 0.05;
      for (const t of this.tracks) {
        if (used.has(t)) continue;
        const d = Math.abs(Math.log(c.f0 / t.f0));
        if (d < bestD) { bestD = d; best = t; }
      }
      if (!best) {
        best = { id: LETTERS[this.nextId % LETTERS.length], f0: c.f0, hits: 0, missed: 0, history: [], strength: 0, hue: (this.nextId * 67 + 150) % 360, conf: 0 };
        this.nextId++;
        this.tracks.push(best);
      }
      used.add(best);
      best.f0 = best.hits ? best.f0 * 0.6 + c.f0 * 0.4 : c.f0;
      best.hits++; best.missed = 0; best.conf = best.conf * 0.85 + 0.15; best.strength = best.strength * 0.7 + c.sal * 0.3;
      best.history.push(c.f0);
    }
    for (const t of this.tracks) {
      if (!used.has(t)) { t.missed++; t.history.push(null); t.strength *= 0.94; t.conf *= 0.85; }
      if (t.history.length > HISTORY) t.history.splice(0, t.history.length - HISTORY);
    }
    // merge tracks that drifted onto the same voice (keep the older id)
    for (let i = 0; i < this.tracks.length; i++) {
      for (let j = i + 1; j < this.tracks.length; j++) {
        const a = this.tracks[i], b = this.tracks[j];
        if (Math.abs(Math.log(a.f0 / b.f0)) < 0.08) {
          const keep = a.hits >= b.hits ? a : b, drop = keep === a ? b : a;
          keep.hits += drop.hits; keep.conf = Math.max(keep.conf, drop.conf); keep.strength = Math.max(keep.strength, drop.strength);
          if (drop.missed === 0) { keep.missed = 0; keep.f0 = drop.f0; keep.history[keep.history.length - 1] = drop.f0; }
          drop.missed = Infinity;
        }
      }
    }
    this.tracks = this.tracks.filter((t) => t.missed < 45);
    return this.tracks.filter((t) => t.hits >= 8 && t.missed < 12 && t.conf > 0.55)
      .sort((a, b) => b.strength - a.strength).slice(0, 4).map((t) => {
      const vals = t.history.filter((v): v is number => v !== null).sort((a, b) => a - b);
      const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
      return {
        kind: 'voice' as const, id: `voice-${t.id}`, label: `Voice ${t.id}`, f0: t.f0,
        lowHz: q(0.1), highHz: q(0.9), medianHz: q(0.5), strength: t.strength, hue: t.hue, history: [...t.history],
      };
    });
  }

  private findBands(excess: Float32Array): BandSource[] {
    const lt = this.longTerm;
    const g = new Float32Array(GRID);
    for (let i = 0; i < GRID; i++) {
      const lo = this.bin(gridHz(Math.max(0, i - 0.5))), hi = Math.max(lo + 1, this.bin(gridHz(Math.min(GRID - 1, i + 0.5))));
      let s = 0, c = 0;
      for (let b = lo; b < Math.min(hi, excess.length); b++) { s += excess[b]; c++; }
      g[i] = c ? s / c : 0;
      lt[i] = lt[i] * 0.9 + g[i] * 0.1;
    }
    const sm = Float32Array.from(lt, (_, i) => (lt[Math.max(0, i - 1)] + 2 * lt[i] + lt[Math.min(GRID - 1, i + 1)]) / 4);
    const th = 22 - this.sensitivity * 14; // dB above the room floor
    const bands: BandSource[] = [];
    let i = 0;
    while (i < GRID) {
      if (sm[i] <= th) { i++; continue; }
      let j = i; while (j + 1 < GRID && sm[j + 1] > th) j++;
      // split the region at deep valleys
      const cuts = [i];
      for (let k = i + 2; k < j - 1; k++) {
        if (sm[k] < sm[k - 1] && sm[k] <= sm[k + 1]) {
          const leftMax = Math.max(...sm.slice(cuts[cuts.length - 1], k));
          const rightMax = Math.max(...sm.slice(k, j + 1));
          if (sm[k] < 0.5 * Math.min(leftMax, rightMax) && k - cuts[cuts.length - 1] >= 4) cuts.push(k);
        }
      }
      cuts.push(j + 1);
      for (let c = 0; c < cuts.length - 1; c++) {
        const a = cuts[c], b = cuts[c + 1] - 1;
        if (b - a < 3) continue; // narrower than about a quarter octave isn't a separate sound
        let peak = a; for (let k = a; k <= b; k++) if (sm[k] > sm[peak]) peak = k;
        bands.push({ kind: 'band', id: `band-${Math.round(gridHz(peak))}`, label: '', lowHz: gridHz(a), highHz: gridHz(b), peakHz: gridHz(peak), level: sm[peak] });
      }
      i = j + 1;
    }
    bands.forEach((b, k) => { b.label = `Sound ${k + 1}`; });
    return bands;
  }
}

/** Find the source under a tapped frequency. Voices win when a harmonic line is within ±6%. */
export function hitTest(frame: Pick<SourceFrame, 'voices' | 'bands'>, hz: number): Source | null {
  let best: VoiceSource | null = null; let bestD = Math.log(1.06);
  for (const v of frame.voices) {
    for (let h = 1; h <= 6; h++) {
      const d = Math.abs(Math.log(hz / (v.f0 * h)));
      if (d < bestD) { bestD = d; best = v; }
    }
  }
  if (best) return best;
  return frame.bands.find((b) => hz >= b.lowHz && hz <= b.highHz) ?? null;
}

/** Log-frequency view window for zooming. */
export interface ScopeView { minHz: number; maxHz: number }
export const FULL_VIEW: ScopeView = { minHz: SCOPE_MIN_HZ, maxHz: SCOPE_MAX_HZ };
export const hzToFrac = (hz: number, v: ScopeView) => Math.log(hz / v.minHz) / Math.log(v.maxHz / v.minHz);
export const fracToHz = (f: number, v: ScopeView) => v.minHz * Math.pow(v.maxHz / v.minHz, f);

/** Zoom around a focal frequency. factor > 1 zooms in. Keeps at least half an octave visible. */
export function zoomView(v: ScopeView, focalHz: number, factor: number): ScopeView {
  const lf = Math.log(focalHz), lmin = Math.log(v.minHz), lmax = Math.log(v.maxHz);
  let span = (lmax - lmin) / factor;
  const minSpan = Math.log(1.414), maxSpan = Math.log(SCOPE_MAX_HZ / SCOPE_MIN_HZ);
  span = Math.max(minSpan, Math.min(maxSpan, span));
  const t = (lf - lmin) / (lmax - lmin);
  let a = lf - t * span, b = a + span;
  if (a < Math.log(SCOPE_MIN_HZ)) { a = Math.log(SCOPE_MIN_HZ); b = a + span; }
  if (b > Math.log(SCOPE_MAX_HZ)) { b = Math.log(SCOPE_MAX_HZ); a = b - span; }
  return { minHz: Math.exp(a), maxHz: Math.exp(b) };
}
export function panView(v: ScopeView, fracDelta: number): ScopeView {
  const lmin = Math.log(v.minHz), lmax = Math.log(v.maxHz), span = lmax - lmin;
  let a = lmin + fracDelta * span;
  a = Math.max(Math.log(SCOPE_MIN_HZ), Math.min(Math.log(SCOPE_MAX_HZ) - span, a));
  return { minHz: Math.exp(a), maxHz: Math.exp(a + span) };
}

export const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`);
