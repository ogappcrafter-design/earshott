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
  /** Seconds of audio already transcribed (lets a stopped job pick up where it left off). */
  transcriptDoneSec?: number;
  /** Email backup progress: parts confirmed sent, out of total. */
  backupSent?: number; backupParts?: number; backupError?: string;
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
  spool: { key: number; value: SpoolPiece; indexes: { bySession: string } };
  /** Audio lives apart from the list, so showing the archive never loads every recording into memory. */
  audio: { key: string; value: Uint8Array };
}

/** Everything about a recording except the sound itself. Cheap to list. */
export type RecordingMeta = Omit<Recording, 'audio'>;

let dbPromise: Promise<IDBPDatabase<EarshotDB>> | null = null;
export function db() {
  if (!dbPromise) {
    dbPromise = openDB<EarshotDB>('earshot', 3, {
      upgrade(d, old) {
        if (old < 1) {
          const r = d.createObjectStore('recordings', { keyPath: 'id' });
          r.createIndex('byDate', 'createdAt');
          d.createObjectStore('voices', { keyPath: 'id' });
        }
        if (old < 2) {
          const sp = d.createObjectStore('spool', { keyPath: 'key', autoIncrement: true });
          sp.createIndex('bySession', 'session');
        }
        if (old < 3) d.createObjectStore('audio');
      },
    });
  }
  return dbPromise;
}
export function resetDbHandleForTests() { dbPromise = null; }

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const toBytes = async (a: unknown): Promise<Uint8Array> =>
  a instanceof Blob ? new Uint8Array(await a.arrayBuffer()) : a instanceof Uint8Array ? a : new Uint8Array(a as ArrayBuffer);

/**
 * Lists recordings WITHOUT their audio. Older versions kept the audio inside each row; those rows are moved
 * over one at a time (each in its own small transaction) so even a huge archive never has to fit in memory.
 */
export async function listRecordings(): Promise<RecordingMeta[]> {
  const d = await db();
  const out: RecordingMeta[] = [];
  // If the app ever dies while reading one row, that row is skipped from then on (kept on disk, never deleted)
  const ls = globalThis.localStorage;
  let skip: string[] = [];
  try {
    skip = JSON.parse(ls?.getItem('earshot.skipRows') || '[]');
    const was = ls?.getItem('earshot.readingRow');
    if (was && !skip.includes(was)) { skip.push(was); ls?.setItem('earshot.skipRows', JSON.stringify(skip)); logError('archive', `skipped a recording that crashed the app while loading (${was})`); }
  } catch { /* storage blocked */ }
  // Once every old row has been moved, rows are tiny and there's nothing left to guard
  const moved = ls?.getItem('earshot.audioSplit') === '1';
  let sawAudio = false;
  for (const key of await d.getAllKeys('recordings')) {
    if (skip.includes(String(key))) continue;
    if (!moved) try { ls?.setItem('earshot.readingRow', String(key)); } catch { /* ignore */ }
    const row = await d.get('recordings', key) as (Recording & { audio?: unknown }) | undefined;
    if (!row) continue;
    if (row.audio != null) {
      sawAudio = true;
      const bytes = await toBytes(row.audio);
      const tx = d.transaction(['recordings', 'audio'], 'readwrite');
      const { audio: _a, ...meta } = row; void _a;
      await tx.objectStore('audio').put(bytes, row.id);
      await tx.objectStore('recordings').put(meta as unknown as Recording);
      await tx.done;
      out.push(meta);
    } else {
      out.push(row);
    }
  }
  try { ls?.removeItem('earshot.readingRow'); if (!sawAudio) ls?.setItem('earshot.audioSplit', '1'); } catch { /* ignore */ }
  return out.sort((x, y) => y.createdAt - x.createdAt);
}

/** Loads one recording's audio only when it's actually needed (play, share, send, transcribe). */
export async function getRecordingAudio(id: string): Promise<Blob | null> {
  const d = await db();
  const bytes = await d.get('audio', id);
  if (bytes) return new Blob([bytes as BlobPart], { type: 'audio/wav' });
  const row = await d.get('recordings', id) as (Recording & { audio?: unknown }) | undefined;
  if (row?.audio != null) return new Blob([await toBytes(row.audio) as BlobPart], { type: 'audio/wav' });
  return null;
}

/** One full recording, audio included. */
export async function getRecording(id: string): Promise<Recording | undefined> {
  const row = await (await db()).get('recordings', id);
  if (!row) return undefined;
  const audio = await getRecordingAudio(id);
  if (!audio) return undefined;
  return { ...row, audio };
}

export async function saveRecording(r: Recording) {
  const d = await db();
  const bytes = await toBytes(r.audio);
  const { audio: _a, ...meta } = r; void _a;
  const tx = d.transaction(['recordings', 'audio'], 'readwrite');
  await tx.objectStore('audio').put(bytes, r.id);
  await tx.objectStore('recordings').put(meta as unknown as Recording);
  await tx.done;
  // Verify it actually landed; throw loudly if not so the UI can tell the user.
  const check = await d.get('audio', r.id);
  if (!check || check.byteLength !== bytes.byteLength) throw new Error('The recording did not save to storage.');
}
export async function deleteRecording(id: string) {
  const tx = (await db()).transaction(['recordings', 'audio'], 'readwrite');
  await tx.objectStore('recordings').delete(id);
  await tx.objectStore('audio').delete(id);
  await tx.done;
}
export async function patchRecording(id: string, patch: Partial<RecordingMeta>) {
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

export function searchRecordings<T extends RecordingMeta>(list: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((r) => r.title.toLowerCase().includes(needle) || (r.transcript?.text ?? '').toLowerCase().includes(needle));
}

export function defaultTitle(d = new Date()) {
  return `Recording ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** A piece of an in-progress recording, written to disk every few seconds so a crash can't lose it. */
export interface SpoolPiece { key?: number; session: string; seq: number; startedAt: number; sampleRate: number; bitDepth: 16 | 24; frames: number; pcm: Blob; bookmarks: number[] }

export async function spoolAppend(p: SpoolPiece) { await (await db()).add('spool', p); }
export async function spoolPieces(session: string): Promise<SpoolPiece[]> {
  return ((await (await db()).getAllFromIndex('spool', 'bySession', session)) as SpoolPiece[]).sort((a, b) => a.seq - b.seq);
}
export async function spoolSessions(): Promise<string[]> {
  // Walk the index keys only: never pulls the audio pieces into memory
  const sessions: string[] = [];
  let cur = await (await db()).transaction('spool').store.index('bySession').openKeyCursor(null, 'nextunique');
  while (cur) { sessions.push(cur.key as string); cur = await cur.continue(); }
  return sessions;
}
export async function spoolClear(session: string) {
  const d = await db(); const tx = d.transaction('spool', 'readwrite');
  for (const k of await tx.store.index('bySession').getAllKeys(session)) await tx.store.delete(k);
  await tx.done;
}

/** Ask the browser/WebView not to delete our storage when the phone gets low on space. */
export async function requestPersistentStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { return false; }
}

/** Last few errors, kept so the Help screen can show what actually failed on this phone. */
const ERR_KEY = 'earshot.errlog.v1';
export function logError(where: string, err: unknown) {
  try {
    const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
    list.unshift({ at: Date.now(), where, msg: (err as Error)?.message ?? String(err) });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* ignore */ }
}
export function readErrorLog(): { at: number; where: string; msg: string }[] {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); } catch { return []; }
}
