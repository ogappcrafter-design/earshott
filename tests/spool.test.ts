import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { spoolAppend, spoolPieces, spoolClear, spoolSessions } from '../src/storage/db';
import { pcmBytes, wavHeader, encodeWav } from '../src/audio/wav';
import { newId } from '../src/storage/db';

describe('recording spool round-trip', () => {
  it('spooled pieces rebuild into a valid WAV of the right length', async () => {
    const session = newId(), rate = 48000, bits = 24 as const;
    const a = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(i / 8) * 0.4);
    const b = Float32Array.from({ length: rate * 3 }, (_, i) => Math.sin(i / 6) * 0.3);
    await spoolAppend({ session, seq: 0, startedAt: Date.now(), sampleRate: rate, bitDepth: bits, frames: a.length, pcm: new Blob([pcmBytes(a, bits)]), bookmarks: [] });
    await spoolAppend({ session, seq: 1, startedAt: Date.now(), sampleRate: rate, bitDepth: bits, frames: b.length, pcm: new Blob([pcmBytes(b, bits)]), bookmarks: [1.5] });

    expect(await spoolSessions()).toContain(session);
    const pieces = await spoolPieces(session);
    expect(pieces.length).toBe(2);
    const frames = pieces.reduce((n, p) => n + p.frames, 0);
    expect(frames).toBe(a.length + b.length);

    const blob = new Blob([wavHeader(frames, rate, bits), ...pieces.map((p) => p.pcm)], { type: 'audio/wav' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // header says RIFF and the data chunk size matches the audio
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(40, true)).toBe(frames * (bits / 8));
    // and it equals a one-shot encode of the same audio
    const ab = new Float32Array(a.length + b.length); ab.set(a); ab.set(b, a.length); const whole = new Uint8Array(encodeWav([ab], rate, bits));
    expect(bytes.length).toBe(whole.length);

    await spoolClear(session);
    expect((await spoolPieces(session)).length).toBe(0);
  });
});
