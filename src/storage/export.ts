import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Recording } from './db';
import { formatTime } from '../ui/format';
import { IS_TESTER } from '../demo';
import { zipFiles } from './zip';

type DownloadsNs = { save: (a: { filename: string; data: Blob | ArrayBuffer | Uint8Array }) => Promise<unknown> };
type ClaudeWin = { claude?: { use: (n: string) => Promise<unknown> } };

/** Tester build: saves go through the preview's download prompt; WAVs travel inside a .zip. */
async function testerSave(blob: Blob, fileName: string): Promise<string> {
  const cw = (window as unknown as ClaudeWin).claude;
  const dl = (await cw?.use('downloads')) as DownloadsNs | null | undefined;
  let name = fileName; let data: Blob | Uint8Array = blob;
  if (fileName.endsWith('.wav')) {
    data = zipFiles([{ name: fileName, data: new Uint8Array(await blob.arrayBuffer()) }]);
    name = fileName.replace(/\.wav$/, '.zip');
  }
  if (!dl) { browserDownload(data instanceof Blob ? data : new Blob([data as BlobPart]), name); return 'Downloads'; }
  try { await dl.save({ filename: name, data }); return 'Downloads'; }
  catch (e) { if ((e as { code?: string })?.code === 'declined') throw new Error('cancelled'); throw e; }
}

export const safeFileName = (s: string) =>
  s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Earshot recording';

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode(...buf.subarray(i, i + step));
  return btoa(bin);
}

export function transcriptToText(r: Recording): string {
  if (!r.transcript) return '';
  const lines = r.transcript.chunks.length
    ? r.transcript.chunks.map((c) => `[${formatTime(c.start)}] ${c.text.trim()}`)
    : [r.transcript.text.trim()];
  return `${r.title}\n${new Date(r.createdAt).toLocaleString()}\nBest-guess transcript (${r.transcript.model})\n\n${lines.join('\n')}\n`;
}

function browserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Save into the phone's Documents/Earshot folder. Returns a human-readable location. */
export async function saveToDevice(blob: Blob, fileName: string): Promise<string> {
  if (IS_TESTER) return testerSave(blob, fileName);
  if (!Capacitor.isNativePlatform()) { browserDownload(blob, fileName); return 'Downloads'; }
  await Filesystem.writeFile({ path: `Earshot/${fileName}`, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
  return 'Documents/Earshot';
}

/** Open the Android share sheet (Drive, email, messages, Files...). */
export async function shareFile(blob: Blob, fileName: string, title: string) {
  if (IS_TESTER) { await testerSave(blob, fileName); return; }
  if (!Capacitor.isNativePlatform()) { browserDownload(blob, fileName); return; }
  const res = await Filesystem.writeFile({ path: fileName, data: await blobToBase64(blob), directory: Directory.Cache });
  await Share.share({ title, url: res.uri, dialogTitle: title });
}

export const audioFileName = (r: Recording) => `${safeFileName(r.title)}.wav`;
export const transcriptFileName = (r: Recording) => `${safeFileName(r.title)} transcript.txt`;
