export const TRANSCRIBE_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', name: 'Fast', note: 'English only, about 40 MB download' },
  { id: 'onnx-community/whisper-base.en', name: 'Balanced', note: 'English only, about 80 MB download' },
  { id: 'onnx-community/whisper-base', name: 'Multilingual', note: '99 languages, about 80 MB download' },
] as const;

export type TranscribeEvent =
  | { type: 'download'; progress: number }
  | { type: 'status'; id: string; status: 'loading' | 'transcribing' }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; message: string };

type Listener = (e: TranscribeEvent) => void;
const listeners = new Set<Listener>();
export const onTranscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const emit = (e: TranscribeEvent) => listeners.forEach((l) => l(e));

