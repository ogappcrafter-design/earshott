import { deleteRecording, getRecordingAudio, getRecordingMeta, type RecordingMeta } from './db';
import { nativeDiscard, nativeFileBytes, type AudioBytes } from '../native/background';

export type { AudioBytes };

/** Opens a recording's audio for slice-by-slice reading, wherever it lives (app storage or a file on the phone). */
export async function openAudio(id: string): Promise<{ meta: RecordingMeta; bytes: AudioBytes } | null> {
  const meta = await getRecordingMeta(id);
  if (!meta) return null;
  if (meta.nativeFile) return { meta, bytes: nativeFileBytes(meta.nativeFile, meta.sizeBytes) };
  const blob = await getRecordingAudio(id);
  return blob ? { meta, bytes: blob } : null;
}

/** Deletes a recording and, for background recordings, its file on the phone. */
export async function removeRecording(id: string) {
  const meta = await getRecordingMeta(id);
  await deleteRecording(id);
  if (meta?.nativeFile) await nativeDiscard(meta.nativeFile);
}
