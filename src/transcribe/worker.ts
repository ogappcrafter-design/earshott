/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { prepareForWhisper, mapTime } from './prep';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowLocalModels = false;
// Run the speech engine from files shipped inside the app instead of a CDN, so only the model needs internet (once).
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href, wasm: new URL(ortWasm, self.location.href).href };
  onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
}

type Req = { id: string; audio: Float32Array; model: string; language: string | null };
type ASR = (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>;

let current: { model: string; asr: ASR } | null = null;

/** Use the phone's GPU when the WebView supports it (often 5-10x faster), otherwise multi-threaded CPU. */
async function hasWebGPU(): Promise<boolean> {
  try { const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu; return !!(gpu && (await gpu.requestAdapter())); }
  catch { return false; }
}

async function load(model: string) {
  if (current?.model === model) return current.asr;
  const gpu = await hasWebGPU();
  const progress_callback = (p: { status: string; progress?: number; file?: string }) => {
    if (p.status === 'progress') self.postMessage({ type: 'download', progress: p.progress ?? 0, file: p.file });
  };
  let asr: ASR;
  try {
    asr = (await pipeline('automatic-speech-recognition', model, gpu
      ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }
      : { device: 'wasm', dtype: 'q8', progress_callback })) as unknown as ASR;
  } catch {
    // GPU path failed on this device: fall back to CPU
    asr = (await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback })) as unknown as ASR;
  }
  current = { model, asr };
  return asr;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, audio, model, language } = e.data;
  try {
    self.postMessage({ type: 'status', id, status: 'loading' });
    const asr = await load(model);
    self.postMessage({ type: 'status', id, status: 'transcribing' });
    const isEnglishOnly = model.endsWith('.en');
    const prep = prepareForWhisper(audio);
    if (prep.audio.length < 1600) { self.postMessage({ type: 'done', id, result: { text: '', chunks: [] } }); return; }
    const out = (await asr(prep.audio, {
      chunk_length_s: 30,
      stride_length_s: 4,
      batch_size: 4,
      no_repeat_ngram_size: 4,
      return_timestamps: true,
      ...(isEnglishOnly ? {} : { task: 'transcribe', language: language ?? undefined }),
    })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
    const chunks = (out.chunks ?? [])
      .filter((c) => c.text.trim().length > 0)
      .map((c) => { const s0 = c.timestamp[0] ?? 0, e0 = c.timestamp[1] ?? s0; return { start: mapTime(s0, prep.segments), end: mapTime(e0, prep.segments), text: c.text }; });
    self.postMessage({ type: 'done', id, result: { text: out.text.trim(), chunks } });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err as Error)?.message ?? 'Transcription failed.' });
  }
};
