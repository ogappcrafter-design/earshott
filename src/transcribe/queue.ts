import { decodeWavBlob, resampleLinear } from './resample';
import { getRecording, patchRecording } from '../storage/db';

import { TRANSCRIBE_MODELS, emit, onTranscribe } from './queue.shared';
export { TRANSCRIBE_MODELS, onTranscribe };

let worker: Worker | null = null;
const queue: { id: string; model: string; language: string | null }[] = [];
let busy = false;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export async function enqueueTranscription(id: string, model: string, language: string | null) {
  if (queue.some((q) => q.id === id)) return;
  await patchRecording(id, { transcriptStatus: 'queued', transcriptError: undefined });
  queue.push({ id, model, language });
  pump();
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  try {
    const rec = await getRecording(job.id);
    if (!rec) return;
    await patchRecording(job.id, { transcriptStatus: 'working' });
    const { samples, sampleRate } = await decodeWavBlob(rec.audio);
    const audio = resampleLinear(samples, sampleRate, 16000);
    const w = getWorker();
    await new Promise<void>((resolve) => {
      const handler = async (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'download') { emit({ type: 'download', progress: m.progress }); return; }
        if (m.id !== job.id) return;
        if (m.type === 'status') emit({ type: 'status', id: job.id, status: m.status });
        if (m.type === 'done') {
          w.removeEventListener('message', handler);
          await patchRecording(job.id, {
            transcriptStatus: 'done',
            transcript: { text: m.result.text, chunks: m.result.chunks, model: job.model, createdAt: Date.now() },
          });
          emit({ type: 'done', id: job.id }); resolve();
        }
        if (m.type === 'error') {
          w.removeEventListener('message', handler);
          const msg = /fetch|network|Failed to/i.test(m.message)
            ? 'The transcription model could not download. Connect to the internet once, then try again.'
            : m.message;
          await patchRecording(job.id, { transcriptStatus: 'failed', transcriptError: msg });
          emit({ type: 'error', id: job.id, message: msg }); resolve();
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ id: job.id, audio, model: job.model, language: job.language }, [audio.buffer]);
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Transcription failed.';
    await patchRecording(job.id, { transcriptStatus: 'failed', transcriptError: msg });
    emit({ type: 'error', id: job.id, message: msg });
  } finally {
    busy = false;
    pump();
  }
}
