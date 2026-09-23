/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
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

async function load(model: string) {
  if (current?.model === model) return current.asr;
  const asr = (await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress') self.postMessage({ type: 'download', progress: p.progress ?? 0, file: p.file });
    },
  })) as unknown as ASR;
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
    const out = (await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      ...(isEnglishOnly ? {} : { task: 'transcribe', language: language ?? undefined }),
    })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
    const chunks = (out.chunks ?? [])
      .filter((c) => c.text.trim().length > 0)
      .map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0, text: c.text }));
    self.postMessage({ type: 'done', id, result: { text: out.text.trim(), chunks } });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err as Error)?.message ?? 'Transcription failed.' });
  }
};
