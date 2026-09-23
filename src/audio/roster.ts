import type { VoiceSource } from './sources';

/** A voice that has been heard steadily long enough to keep on screen. */
export interface HeardVoice {
  id: string; label: string; hue: number;
  lowHz: number; medianHz: number; highHz: number;
  /** total seconds heard */ heard: number;
  lastSeen: number; listed: boolean; present: boolean;
  /** smoothed harmonic strength (relative loudness) */ strength: number;
  /** running mean/variance of log-pitch, for how lively the voice is */ n: number; mean: number; m2: number;
}

const MATCH = 0.12;      // same voice if median pitch within ~12%
const LIST_AFTER = 3;    // seconds of steady voice before it gets listed
const FORGET = 4;        // unlisted candidates forgotten after this many seconds of silence
const MAX = 8;

/**
 * Turns flickering frame-by-frame voice detections into a stable list of people.
 * Anyone heard for 3+ seconds sticks around (greyed out when quiet) so they can be tapped any time.
 */
export class VoiceRoster {
  private list: HeardVoice[] = [];
  private seq = 0;

  update(voices: VoiceSource[], now: number, dt: number): HeardVoice[] {
    for (const r of this.list) r.present = false;
    for (const v of voices) {
      let best: HeardVoice | null = null, bestD = MATCH;
      for (const r of this.list) { const d = Math.abs(Math.log(v.medianHz / r.medianHz)); if (d < bestD) { bestD = d; best = r; } }
      if (!best) {
        if (this.list.length >= MAX) this.evict();
        best = { id: `heard-${++this.seq}`, label: `Voice ${this.seq}`, hue: v.hue, lowHz: v.lowHz, medianHz: v.medianHz, highHz: v.highHz, heard: 0, lastSeen: now, listed: false, present: false, strength: v.strength, n: 0, mean: 0, m2: 0 };
        this.list.push(best);
      }
      if (best.present) continue;
      const a = best.listed ? 0.03 : 0.15; // settle the profile, then only drift slowly
      best.medianHz += (v.medianHz - best.medianHz) * a;
      best.lowHz += (v.lowHz - best.lowHz) * a;
      best.highHz += (v.highHz - best.highHz) * a;
      best.strength += (v.strength - best.strength) * 0.2;
      const lp = Math.log(v.f0); best.n++; const d0 = lp - best.mean; best.mean += d0 / best.n; best.m2 += d0 * (lp - best.mean);
      best.heard += dt; best.lastSeen = now; best.present = true;
      if (!best.listed && best.heard >= LIST_AFTER) best.listed = true;
    }
    this.list = this.list.filter((r) => r.listed || now - r.lastSeen < FORGET);
    return this.listed();
  }

  listed(): HeardVoice[] { return this.list.filter((r) => r.listed).sort((a, b) => a.medianHz - b.medianHz); }
  rename(id: string, label: string) { const r = this.list.find((x) => x.id === id); if (r) r.label = label; }
  remove(id: string) { this.list = this.list.filter((r) => r.id !== id); }
  clear() { this.list = []; }

  private evict() {
    const pool = this.list.filter((r) => !r.listed);
    const victim = (pool.length ? pool : this.list).reduce((a, b) => (a.lastSeen < b.lastSeen ? a : b));
    this.list = this.list.filter((r) => r !== victim);
  }
}

export interface VoiceInfo { voice: string; age: string; level: string; distance: string; style: string; note: string }

/**
 * Plain-English read on a voice, from pitch and loudness only. These are rough guesses
 * (pitch overlaps a lot between people) and are worded that way on screen.
 */
export function describeVoice(h: HeardVoice, all: HeardVoice[]): VoiceInfo {
  const f = h.medianHz;
  const voice = f < 150 ? 'Likely male' : f < 170 ? 'Probably male' : f < 190 ? 'Hard to tell' : f < 260 ? 'Likely female' : 'High voice';
  const age = f >= 270 ? 'Possibly a child' : f >= 240 ? 'Child or young adult' : 'Adult';
  const s = h.strength;
  const level = s < 12 ? 'Very quiet, near whisper' : s < 28 ? 'Soft-spoken' : s < 60 ? 'Normal talking' : 'Loud or close up';
  const loudest = Math.max(...all.map((x) => x.strength), 1e-6);
  const rel = s / loudest;
  const distance = all.length < 2 ? (s < 20 ? 'Probably across the room' : s < 45 ? 'A few steps away' : 'Close to the phone')
    : rel > 0.85 ? 'Closest voice here' : rel > 0.5 ? 'A bit farther than the closest' : 'Farthest away';
  const sd = h.n > 4 ? Math.sqrt(h.m2 / (h.n - 1)) : 0; // in log units: 0.1 ≈ ±10%
  const style = h.n < 5 ? 'Still listening…' : sd < 0.05 ? 'Flat or monotone' : sd < 0.12 ? 'Even, calm' : 'Lively, expressive';
  return { voice, age, level, distance, style, note: 'Rough guesses from pitch and volume, not ID.' };
}
