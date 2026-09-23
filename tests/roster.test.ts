import { describe, it, expect } from 'vitest';
import { VoiceRoster } from '../src/audio/roster';
import type { VoiceSource } from '../src/audio/sources';
const v = (hz: number, id = 'x'): VoiceSource => ({ kind: 'voice', id, label: 'Voice', f0: hz, lowHz: hz * 0.8, highHz: hz * 1.3, medianHz: hz, strength: 1, hue: 200, history: [] });
describe('VoiceRoster', () => {
  it('lists a voice after 3s of steady tone even with flicker, keeps it after silence', () => {
    const r = new VoiceRoster(); let t = 0;
    for (let i = 0; i < 12; i++) { t += 0.25; r.update(i % 3 === 2 ? [] : [v(120 + (i % 2) * 5)], t, 0.25); }
    expect(r.listed().length).toBe(0);
    for (let i = 0; i < 10; i++) { t += 0.25; r.update([v(122)], t, 0.25); }
    expect(r.listed().length).toBe(1);
    for (let i = 0; i < 40; i++) { t += 0.25; r.update([], t, 0.25); }
    expect(r.listed()[0].present).toBe(false);
    expect(r.listed().length).toBe(1);
  });
  it('keeps two voices separate', () => {
    const r = new VoiceRoster(); let t = 0;
    for (let i = 0; i < 16; i++) { t += 0.25; r.update([v(110), v(220)], t, 0.25); }
    expect(r.listed().map((x) => Math.round(x.medianHz))).toEqual([110, 220]);
  });
});
import { describeVoice } from '../src/audio/roster';
describe('describeVoice', () => {
  it('gives plain guesses', () => {
    const r = new VoiceRoster(); let t = 0;
    for (let i = 0; i < 16; i++) { t += 0.25; r.update([v(110), v(230)], t, 0.25); }
    const [lo, hi] = r.listed();
    expect(describeVoice(lo, r.listed()).voice).toBe('Likely male');
    expect(describeVoice(hi, r.listed()).voice).toBe('Likely female');
  });
});
