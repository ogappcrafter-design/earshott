import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface TranscriptChunk { start: number; end: number; text: string }
export interface Transcript { text: string; chunks: TranscriptChunk[]; model: string; createdAt: number }

export interface Recording {
  id: string;
  title: string;
  createdAt: number;
  durationSec: number;
  sampleRate: number;
  bitDepth: 16 | 24;
  sizeBytes: number;
  audio: Blob;
  bookmarks: number[];
  voiceProfileId: string | null;
  transcript: Transcript | null;
  transcriptStatus: 'none' | 'queued' | 'working' | 'done' | 'failed';
  transcriptError?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  medianHz: number;
  lowHz: number;
  highHz: number;
  createdAt: number;
  colorHue: number;
}

interface EarshotDB extends DBSchema {
  recordings: { key: string; value: Recording; indexes: { byDate: number } };
  voices: { key: string; value: VoiceProfile };
}

let dbPromise: Promise<IDBPDatabase<EarshotDB>> | null = null;
export function db() {
  if (!dbPromise) {
    dbPromise = openDB<EarshotDB>('earshot', 1, {
      upgrade(d) {
        const r = d.createObjectStore('recordings', { keyPath: 'id' });
        r.createIndex('byDate', 'createdAt');
        d.createObjectStore('voices', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}
export function resetDbHandleForTests() { dbPromise = null; }

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export async function listRecordings(): Promise<Recording[]> {
  const all = await (await db()).getAllFromIndex('recordings', 'byDate');
  return all.reverse();
}
export async function getRecording(id: string) { return (await db()).get('recordings', id); }
export async function saveRecording(r: Recording) { await (await db()).put('recordings', r); }
export async function deleteRecording(id: string) { await (await db()).delete('recordings', id); }
export async function patchRecording(id: string, patch: Partial<Recording>) {
  const d = await db();
  const tx = d.transaction('recordings', 'readwrite');
  const cur = await tx.store.get(id);
  if (cur) await tx.store.put({ ...cur, ...patch });
  await tx.done;
}

export async function listVoices(): Promise<VoiceProfile[]> {
  return (await (await db()).getAll('voices')).sort((a, b) => a.createdAt - b.createdAt);
}
export async function saveVoice(v: VoiceProfile) { await (await db()).put('voices', v); }
export async function deleteVoice(id: string) { await (await db()).delete('voices', id); }

export function searchRecordings(list: Recording[], q: string): Recording[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((r) => r.title.toLowerCase().includes(needle) || (r.transcript?.text ?? '').toLowerCase().includes(needle));
}

export function defaultTitle(d = new Date()) {
  return `Recording ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
