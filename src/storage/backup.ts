import { deleteRecording, getRecording, listRecordings, patchRecording, type Recording } from './db';
import { transcriptToText } from './export';
import { zipFilesCompressed } from './zip';
import { wavHeader } from '../audio/wav';

export const BACKUP_URL = 'https://earshott.vercel.app/api/backup';
/** Vercel allows 4.5 MB per upload: keep each part's raw audio under this so even uncompressible audio fits. */
const PART_BYTES = 3_900_000;

export interface BackupConfig { emailBackup: boolean; backupKey: string; deleteAfterSend: boolean }
type Listener = () => void;
const listeners = new Set<Listener>();
export const onBackupChange = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const changed = () => listeners.forEach((f) => f());

const safe = (t: string) => t.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'recording';

/** Split a WAV into playable pieces (each with its own header), then zip each losslessly. */
export async function buildParts(rec: Recording): Promise<Uint8Array[]> {
  const wav = new Uint8Array(await rec.audio.arrayBuffer());
  const pcm = wav.subarray(44);
  const bps = rec.bitDepth / 8;
  const per = Math.floor(PART_BYTES / bps) * bps;
  const pieces = Math.max(1, Math.ceil(pcm.length / per));
  const base = safe(rec.title);
  const text = new TextEncoder().encode(transcriptToText(rec) || 'No transcript.');
  const out: Uint8Array[] = [];
  for (let i = 0; i < pieces; i++) {
    const slice = pcm.subarray(i * per, Math.min(pcm.length, (i + 1) * per));
    const file = new Uint8Array(44 + slice.length);
    file.set(new Uint8Array(wavHeader(slice.length / bps, rec.sampleRate, rec.bitDepth)), 0);
    file.set(slice, 44);
    const name = pieces > 1 ? `${base}_part${i + 1}of${pieces}.wav` : `${base}.wav`;
    const files = [{ name, data: file }];
    if (i === 0) files.push({ name: `${base}_transcript.txt`, data: text });
    out.push(await zipFilesCompressed(files));
  }
  return out;
}

let running = false;
const waiting = new Set<string>();

/** Queue a recording to be emailed. Safe to call repeatedly. */
export function queueBackup(id: string, cfg: BackupConfig) {
  if (!cfg.emailBackup || !cfg.backupKey) return;
  waiting.add(id); void run(cfg);
}

/** On launch or when the phone comes back online: send anything that hasn't gone out yet. */
export async function resumeBackups(cfg: BackupConfig) {
  if (!cfg.emailBackup || !cfg.backupKey) return;
  for (const r of await listRecordings()) {
    const transcribing = r.transcriptStatus === 'queued' || r.transcriptStatus === 'working';
    if (!transcribing && (r.backupSent ?? 0) < (r.backupParts ?? Infinity)) waiting.add(r.id);
  }
  void run(cfg);
}

async function run(cfg: BackupConfig) {
  if (running) return;
  running = true;
  try {
    while (waiting.size) {
      const id = waiting.values().next().value as string; waiting.delete(id);
      const rec = await getRecording(id);
      if (!rec) continue;
      try {
        const parts = await buildParts(rec);
        const title = rec.title;
        const preview = (rec.transcript?.text ?? '').slice(0, 1500);
        let sent = rec.backupParts === parts.length ? rec.backupSent ?? 0 : 0;
        await patchRecording(id, { backupParts: parts.length, backupSent: sent, backupError: undefined }); changed();
        for (let i = sent; i < parts.length; i++) {
          const res = await fetch(BACKUP_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/zip', 'x-earshot-key': cfg.backupKey,
              'x-part': String(i + 1), 'x-parts': String(parts.length),
              'x-title': encodeURIComponent(title),
              'x-filename': encodeURIComponent(`${safe(title)}${parts.length > 1 ? `_part${i + 1}` : ''}.zip`),
              'x-transcript': i === 0 ? encodeURIComponent(preview) : '',
            },
            body: new Blob([parts[i] as Uint8Array<ArrayBuffer>]),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
          sent = i + 1;
          await patchRecording(id, { backupSent: sent }); changed();
        }
        // Every part confirmed accepted by the mail service: now it's safe to free the space
        if (cfg.deleteAfterSend) await deleteRecording(id);
        changed();
      } catch (err) {
        const msg = (err as Error).message;
        await patchRecording(id, { backupError: /Failed to fetch|NetworkError|Load failed/i.test(msg) ? 'Waiting for internet to send.' : msg }).catch(() => undefined);
        changed();
        // Leave it on the phone; it's retried on next launch or when the connection comes back
      }
    }
  } finally { running = false; }
}
