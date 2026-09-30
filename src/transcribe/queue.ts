import { decodeWavBlob, resampleLinear } from './resample';
import { getRecording, listRecordings, patchRecording, type TranscriptChunk } from '../storage/db';
import { TRANSCRIBE_MODELS, emit, onTranscribe } from './queue.shared';
export { TRANSCRIBE_MODELS, onTranscribe };

const RATE = 16000;
const PIECE_SEC = 120;          // work in 2-minute pieces, each saved as soon as it's done
const STALL_MS = 4 * 60_000;    // no word from the worker for 4 min = stuck, restart it

let worker: Worker | null = null;
let forceCpu = false;
const queue: { id: string; model: string; language: string | null }[] = [];
let busy = false;

function getWorker() {
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return worker;
}
function killWorker() { worker?.terminate(); worker = null; }

export async function enqueueTranscription(id: string, model: string, language: string | null) {
  if (queue.some((q) => q.id === id)) return;
  await patchRecording(id, { transcriptStatus: 'queued', transcriptError: undefined });
  queue.push({ id, model, language });
  pump();
}

/** On app launch: anything left queued or half-done gets picked back up automatically. */
export async function resumePendingTranscriptions(model: string, language: string | null) {
  for (const r of await listRecordings()) {
    if (r.transcriptStatus === 'queued' || r.transcriptStatus === 'working') {
      queue.push({ id: r.id, model: r.transcript?.model ?? model, language });
    }
  }
  pump();
}

/** Cut near `at` but at the quietest spot within ±3 s, so pieces don't split a word. */
function quietCut(a: Float32Array, at: number): number {
  const w = Math.round(RATE * 0.05), span = RATE * 3;
  let best = at, bestE = Infinity;
  for (let c = Math.max(w, at - span); c < Math.min(a.length - w, at + span); c += w) {
    let e = 0; for (let i = c - w; i < c + w; i++) e += a[i] * a[i];
    if (e < bestE) { bestE = e; best = c; }
  }
  return best;
}

function runPiece(audio: Float32Array, job: { id: string; model: string; language: string | null }): Promise<{ text: string; chunks: TranscriptChunk[] }> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    let timer = setTimeout(stall, STALL_MS);
    function stall() { cleanup(); killWorker(); reject(new Error('stalled')); }
    function cleanup() { clearTimeout(timer); w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); }
    function onErr() { cleanup(); killWorker(); reject(new Error('crashed')); }
    function onMsg(e: MessageEvent) {
      const m = e.data;
      clearTimeout(timer); timer = setTimeout(stall, STALL_MS); // any sign of life resets the watchdog
      if (m.type === 'download') { emit({ type: 'download', progress: m.progress }); return; }
      if (m.id !== job.id) return;
      if (m.type === 'done') { cleanup(); resolve(m.result); }
      if (m.type === 'error') { cleanup(); reject(new Error(m.message)); }
    }
    w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
    w.postMessage({ id: job.id, audio, model: job.model, language: job.language, cpu: forceCpu }, [audio.buffer]);
  });
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
    const audio = resampleLinear(samples, sampleRate, RATE);
    const total = audio.length / RATE;

    // Resume from wherever the last run stopped
    let doneSec = rec.transcript?.model === job.model ? rec.transcriptDoneSec ?? 0 : 0;
    const chunks: TranscriptChunk[] = doneSec ? [...(rec.transcript?.chunks ?? [])] : [];
    let retried = false;

    while (doneSec < total - 0.25) {
      const start = Math.round(doneSec * RATE);
      const end = start + PIECE_SEC * RATE >= audio.length ? audio.length : quietCut(audio, start + PIECE_SEC * RATE);
      emit({ type: 'status', id: job.id, status: 'transcribing', progress: Math.round((doneSec / total) * 100) });
      let out;
      try { out = await runPiece(audio.slice(start, end), job); }
      catch (err) {
        const msg = (err as Error).message;
        if (/fetch|network|Failed to/i.test(msg)) throw new Error('The transcription model could not download. Connect to the internet once, then try again.');
        if (retried) throw new Error('Transcription kept stalling on this phone. Try the Fast model in Settings.');
        retried = true; forceCpu = true; continue; // GPU path hung or crashed: retry this piece on CPU
      }
      const off = start / RATE;
      for (const c of out.chunks) if (c.text.trim()) chunks.push({ start: c.start + off, end: c.end + off, text: c.text });
      doneSec = end / RATE;
      // Save progress after every piece, so closing the app never throws away finished work
      await patchRecording(job.id, {
        transcript: { text: chunks.map((c) => c.text.trim()).join(' '), chunks, model: job.model, createdAt: Date.now() },
        transcriptDoneSec: doneSec,
      });
      emit({ type: 'status', id: job.id, status: 'transcribing', progress: Math.round((doneSec / total) * 100) });
    }
    await patchRecording(job.id, { transcriptStatus: 'done', transcriptDoneSec: total });
    emit({ type: 'done', id: job.id });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Transcription failed.';
    await patchRecording(job.id, { transcriptStatus: 'failed', transcriptError: msg });
    emit({ type: 'error', id: job.id, message: msg });
  } finally {
    busy = false;
    pump();
  }
}
