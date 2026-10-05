import { Capacitor, registerPlugin } from '@capacitor/core';
import { defaultTitle, newId, saveRecording, type Recording } from '../storage/db';

interface BgFile { name: string; path: string; startedAt: number; bytes: number; durationSec: number }
interface EarshotNative {
  start(): Promise<{ started: boolean; error?: string }>;
  takeRecordings(): Promise<{ files: BgFile[]; recording: boolean }>;
  discard(o: { name: string }): Promise<void>;
  addListener(ev: 'state', fn: (s: { recording: boolean }) => void): Promise<{ remove(): void }>;
}

export const isNative = Capacitor.isNativePlatform();
const Native = registerPlugin<EarshotNative>('Earshot');

/** Start the quiet notification service. Safe to call repeatedly; does nothing in the browser. */
export async function startBackground(): Promise<void> {
  if (!isNative) return;
  try { await Native.start(); } catch { /* service is optional */ }
}

/** Pull recordings made from the notification into the archive, then delete the phone copy. Returns new ids. */
export async function importBackgroundRecordings(): Promise<string[]> {
  if (!isNative) return [];
  const ids: string[] = [];
  try {
    const { files } = await Native.takeRecordings();
    for (const f of files) {
      try {
        const res = await fetch(Capacitor.convertFileSrc('file://' + f.path));
        if (!res.ok) continue;
        const audio = new Blob([await res.arrayBuffer()], { type: 'audio/wav' });
        if (audio.size < 48000) continue;
        const rec: Recording = {
          id: newId(), title: defaultTitle(new Date(f.startedAt)), createdAt: f.startedAt, durationSec: f.durationSec,
          sampleRate: 48000, bitDepth: 16, sizeBytes: audio.size, audio, bookmarks: [], voiceProfileId: null,
          transcript: null, transcriptStatus: 'none',
        };
        await saveRecording(rec);      // verifies the write landed
        await Native.discard({ name: f.name }); // only deleted after it is safely in the archive
        ids.push(rec.id);
      } catch { /* leave the file; it is retried next time */ }
    }
  } catch { /* plugin unavailable */ }
  return ids;
}

export function onBackgroundState(fn: (recording: boolean) => void): () => void {
  if (!isNative) return () => undefined;
  let handle: { remove(): void } | null = null;
  Native.addListener('state', (s) => fn(s.recording)).then((h) => { handle = h; }).catch(() => undefined);
  return () => handle?.remove();
}
