import { patchRecording } from '../storage/db';
export { TRANSCRIBE_MODELS, onTranscribe } from './queue.shared';

/** Tester build: the ~40 MB speech model and engine can’t ship inside a single-page preview. */
export async function enqueueTranscription(id: string, _model: string, _language: string | null) {
  void _model; void _language;
  await patchRecording(id, {
    transcriptStatus: 'failed',
    transcriptError: 'Transcripts run inside the installed Android app. This browser preview skips the speech model to stay small.',
  });
}
