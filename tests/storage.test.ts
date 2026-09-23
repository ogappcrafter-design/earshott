import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteRecording, getRecording, listRecordings, patchRecording, saveRecording, searchRecordings, saveVoice, listVoices, type Recording } from '../src/storage/db';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/state/settings';
import { safeFileName, transcriptToText } from '../src/storage/export';
import { formatTime, formatBytes } from '../src/ui/format';

const rec = (id: string, t: number, title = `R ${id}`): Recording => ({
  id, title, createdAt: t, durationSec: 5, sampleRate: 48000, bitDepth: 16, sizeBytes: 10, audio: new Blob([new Uint8Array(4)]),
  bookmarks: [], voiceProfileId: null, transcript: null, transcriptStatus: 'none',
});

describe('archive db', () => {
  it('saves, orders newest first, patches, searches, deletes', async () => {
    await saveRecording(rec('a', 1)); await saveRecording(rec('b', 2));
    expect((await listRecordings()).map((r) => r.id)).toEqual(['b', 'a']);
    await patchRecording('a', { transcriptStatus: 'done', transcript: { text: 'meet at the lantern', chunks: [{ start: 3, end: 5, text: ' meet at the lantern' }], model: 'm', createdAt: 0 } });
    const a = (await getRecording('a'))!;
    expect(a.transcriptStatus).toBe('done');
    expect(searchRecordings(await listRecordings(), 'LANTERN').map((r) => r.id)).toEqual(['a']);
    expect(transcriptToText(a)).toContain('[0:03] meet at the lantern');
    await deleteRecording('a');
    expect((await listRecordings()).map((r) => r.id)).toEqual(['b']);
  });
  it('patching a missing record is a no-op', async () => { await patchRecording('nope', { title: 'x' }); expect(await getRecording('nope')).toBeUndefined(); });
  it('stores voices', async () => {
    await saveVoice({ id: 'v', name: 'Mom', medianHz: 200, lowHz: 170, highHz: 260, createdAt: 1, colorHue: 10 });
    expect((await listVoices())[0].name).toBe('Mom');
  });
});

describe('settings', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('defaults when empty or corrupt', () => {
    const s = mem(); expect(loadSettings(s).bitDepth).toBe(DEFAULT_SETTINGS.bitDepth);
    s.setItem('earshot.settings.v1', '{broken'); expect(loadSettings(s).onboarded).toBe(false);
  });
  it('round-trips and repairs EQ', () => {
    const s = mem();
    saveSettings({ ...DEFAULT_SETTINGS, onboarded: true, engine: { ...DEFAULT_SETTINGS.engine, eq: [50] } }, s);
    const l = loadSettings(s); expect(l.onboarded).toBe(true); expect(l.engine.eq[0]).toBe(15); expect(l.engine.eq).toHaveLength(10);
  });
});

describe('format helpers', () => {
  it('formats', () => {
    expect(formatTime(0)).toBe('0:00'); expect(formatTime(65.9)).toBe('1:05'); expect(formatTime(3725)).toBe('1:02:05');
    expect(formatBytes(2048)).toBe('2 KB'); expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(safeFileName('a/b:c*?  d')).toBe('abc d'); expect(safeFileName('///')).toBe('Earshot recording');
  });
});
