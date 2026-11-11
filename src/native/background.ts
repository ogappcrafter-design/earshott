import { Capacitor, registerPlugin } from '@capacitor/core';
import { defaultTitle, listRecordings, newId, saveRecordingMeta, type RecordingMeta } from '../storage/db';

interface BgFile { name: string; path: string; startedAt: number; bytes: number; durationSec: number }
interface EarshotNative {
  start(): Promise<{ started: boolean; error?: string }>;
  takeRecordings(): Promise<{ files: BgFile[]; recording: boolean }>;
  discard(o: { name: string }): Promise<void>;
  readChunk(o: { name: string; offset: number; length: number }): Promise<{ data: string; size: number }>;
  exportRecording(o: { name: string; fileName: string; target: 'cache' | 'documents' }): Promise<{ uri: string }>;
  record(): Promise<{ ok: boolean; error?: string }>;
  stopRecording(): Promise<void>;
  status(): Promise<{ recording: boolean; startedAt: number }>;
  lastExit(): Promise<{ exits: { at: number; reason: number; description: string; importance: number; pssKB: number; rssKB: number }[]; javaCrash?: string }>;
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
/**
 * Adds finished background recordings to the archive WITHOUT reading their audio.
 * The audio stays in its file on the phone and is read in small slices only when played, transcribed or sent.
 * (Copying whole files into memory is what used to crash the app after long recordings.)
 */
export async function importBackgroundRecordings(): Promise<string[]> {
  if (!isNative) return [];
  const ids: string[] = [];
  try {
    const { files } = await Native.takeRecordings();
    if (!files.length) return ids;
    const known = new Set((await listRecordings()).map((r) => r.nativeFile).filter(Boolean));
    for (const f of files) {
      try {
        if (known.has(f.name)) continue;
        if (f.bytes < 48000) { await Native.discard({ name: f.name }); continue; } // under half a second: nothing in it
        const rec: RecordingMeta = {
          id: newId(), title: defaultTitle(new Date(f.startedAt)), createdAt: f.startedAt, durationSec: f.durationSec,
          sampleRate: 48000, bitDepth: 16, sizeBytes: f.bytes, bookmarks: [], voiceProfileId: null,
          transcript: null, transcriptStatus: 'none', nativeFile: f.name, nativePath: f.path,
        };
        await saveRecordingMeta(rec);
        ids.push(rec.id);
      } catch { /* retried next time */ }
    }
  } catch { /* plugin unavailable */ }
  return ids;
}

/** Bytes of a recording that can be read a slice at a time (a Blob works; so does a file on the phone). */
export interface AudioBytes { size: number; slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } }

const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const CHUNK = 1_500_000;

/** A background recording's file, read in small slices through the app's native side. */
export function nativeFileBytes(name: string, size: number): AudioBytes {
  return {
    size,
    slice(start = 0, end = size) {
      const a = Math.max(0, Math.min(size, start)), b = Math.max(a, Math.min(size, end));
      return {
        async arrayBuffer() {
          const out = new Uint8Array(b - a);
          for (let off = a; off < b; off += CHUNK) {
            const { data } = await Native.readChunk({ name, offset: off, length: Math.min(CHUNK, b - off) });
            const part = fromBase64(data);
            if (!part.length) break;
            out.set(part.subarray(0, Math.min(part.length, b - off)), off - a);
          }
          return out.buffer as ArrayBuffer;
        },
      };
    },
  };
}
export const nativeFileUrl = (path: string) => Capacitor.convertFileSrc('file://' + path);
export async function nativeDiscard(name: string) { if (isNative) { try { await Native.discard({ name }); } catch { /* already gone */ } } }
export async function nativeExport(name: string, fileName: string, target: 'cache' | 'documents'): Promise<string> {
  return (await Native.exportRecording({ name, fileName, target })).uri;
}

export function onBackgroundState(fn: (recording: boolean) => void): () => void {
  if (!isNative) return () => undefined;
  let handle: { remove(): void } | null = null;
  Native.addListener('state', (s) => fn(s.recording)).then((h) => { handle = h; }).catch(() => undefined);
  return () => handle?.remove();
}

/** Record through the phone's background service: survives minimizing the app and locking the screen. */
export async function nativeRecord(): Promise<{ ok: boolean; error?: string }> {
  if (!isNative) return { ok: false, error: 'not the installed app' };
  try { return await Native.record(); } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
}
export async function nativeStop(): Promise<void> { if (isNative) { try { await Native.stopRecording(); } catch { /* ignore */ } } }
export async function nativeStatus(): Promise<{ recording: boolean; startedAt: number }> {
  if (!isNative) return { recording: false, startedAt: 0 };
  try { return await Native.status(); } catch { return { recording: false, startedAt: 0 }; }
}

/** Android's own record of why the app was closed recently. */
export async function nativeLastExit() {
  if (!isNative) return null;
  try { return await Native.lastExit(); } catch { return null; }
}
