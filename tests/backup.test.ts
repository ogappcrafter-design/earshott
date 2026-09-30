import { describe, it, expect } from 'vitest';
import { buildParts } from '../src/storage/backup';
import { encodeWav } from '../src/audio/wav';
import type { Recording } from '../src/storage/db';
const rec = (sec: number): Recording => {
  const s = Float32Array.from({ length: 48000 * sec }, (_, i) => Math.sin(i / 9) * 0.3);
  const audio = new Blob([encodeWav([s], 48000, 24)], { type: 'audio/wav' });
  return { id: 'a', title: 'Test take', createdAt: 0, durationSec: sec, sampleRate: 48000, bitDepth: 24, sizeBytes: audio.size, audio,
    bookmarks: [], voiceProfileId: null, transcript: null, transcriptStatus: 'none' };
};
describe('email parts', () => {
  it('short recording = 1 part, long = several, each under the upload cap', async () => {
    expect((await buildParts(rec(5))).length).toBe(1);
    const long = await buildParts(rec(90)); // ~13 MB of 24-bit audio
    expect(long.length).toBeGreaterThanOrEqual(4);
    for (const p of long) expect(p.length).toBeLessThan(4_400_000);
  });
});
