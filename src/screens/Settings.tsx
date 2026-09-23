import { useState } from 'react';
import { TRANSCRIBE_MODELS } from '../transcribe/queue';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS } from '../state/settings';
import { WordArt } from '../ui/WordArt';
import { Button, Confirm, Toggle } from '../ui/Controls';
import { SUPPORT_EMAIL } from '../config';

const LANGS: [string | null, string][] = [[null, 'Detect automatically'], ['english', 'English'], ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['portuguese', 'Portuguese'], ['chinese', 'Chinese'], ['arabic', 'Arabic'], ['hindi', 'Hindi']];

export function Settings({ onHearingCheck, onReplayIntro, onReplayTutorial, toast }: { onHearingCheck: () => void; onReplayIntro: () => void; onReplayTutorial?: () => void; toast: (t: string) => void }) {
  const s = useStore();
  const [reset, setReset] = useState(false);
  const set = s.setSettings;
  const multilingual = !s.settings.transcribeModel.endsWith('.en');
  return (
    <div className="screen">
      <header className="screen__head"><WordArt text="Settings" /></header>

      <section className="panel">
        <h3>Recording quality</h3>
        <div className="seg" role="radiogroup" aria-label="Bit depth">
          {([16, 24] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={s.settings.bitDepth === b} className={s.settings.bitDepth === b ? 'is-on' : ''}
              onClick={() => set((x) => ({ ...x, bitDepth: b }))}>{b === 16 ? '16-bit (smaller)' : '24-bit (studio)'}</button>
          ))}
        </div>
        <p className="fine">48 kHz WAV. One minute is about {s.settings.bitDepth === 16 ? '5.5' : '8.3'} MB.</p>
      </section>

      <section className="panel">
        <h3>Transcription</h3>
        <Toggle label="Transcribe automatically" checked={s.settings.autoTranscribe} onChange={(v) => set((x) => ({ ...x, autoTranscribe: v }))}
          hint="Starts right after each recording saves." />
        <div className="radio-list" role="radiogroup" aria-label="Transcription model">
          {TRANSCRIBE_MODELS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={s.settings.transcribeModel === m.id}
              className={s.settings.transcribeModel === m.id ? 'is-on' : ''} onClick={() => set((x) => ({ ...x, transcribeModel: m.id }))}>
              <strong>{m.name}</strong><small>{m.note}</small>
            </button>
          ))}
        </div>
        {multilingual && (
          <label className="field"><span>Language</span>
            <select value={s.settings.language ?? ''} onChange={(e) => set((x) => ({ ...x, language: e.target.value || null }))}>
              {LANGS.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}
            </select>
          </label>
        )}
        <p className="fine">The model downloads once, then works offline.</p>
      </section>

      <section className="panel">
        <h3>App</h3>
        <Toggle label="Interface sounds" checked={s.settings.sounds} onChange={(v) => set((x) => ({ ...x, sounds: v }))} />
        <Button variant="ghost" onClick={onHearingCheck}>Redo tone check</Button>
        <Button variant="ghost" onClick={onReplayIntro}>Replay the intro</Button>
        {onReplayTutorial && <Button variant="ghost" onClick={onReplayTutorial}>Replay the walkthrough</Button>}
      </section>

      <section className="panel">
        <h3>Help</h3>
        <details><summary>I hear an echo or delay</summary><p>Bluetooth earbuds add 100–200 ms of delay. Switch to wired or USB-C earbuds for live listening. Recording works fine with any earbuds.</p></details>
        <details><summary>There’s a loud squeal</summary><p>That’s feedback: the phone speaker is feeding the microphone. Stop listening, plug in earbuds, then start again.</p></details>
        <details><summary>Focus mode isn’t picking out the voice</summary><p>Focus works best when the voice you locked is the loudest nearby. Re-record the sample in a quiet room, and pair Focus with Noise reduction around 60%.</p></details>
        <details><summary>Where are my saved files?</summary><p>“Save to phone” puts WAV files in Documents/Earshot. Open them with any file manager.</p></details>
        <details><summary>Is this a hearing aid?</summary><p>No. Earshot is a personal sound amplifier. For hearing loss, an audiologist can fit a medical device.</p></details>
        <a className="btn btn--ghost" href={`mailto:${SUPPORT_EMAIL}?subject=Earshot%20feedback`}>Send feedback</a>
      </section>

      <Button variant="danger" onClick={() => setReset(true)}>Reset all settings</Button>
      <p className="fine center">Earshot 1.0 by Outbox Enter</p>

      <Confirm open={reset} title="Reset settings?" body="EQ, sliders and preferences go back to default. Your recordings and voices stay."
        confirmLabel="Reset settings" danger onCancel={() => setReset(false)}
        onConfirm={() => { set((x) => ({ ...DEFAULT_SETTINGS, onboarded: true, hearingEq: x.hearingEq })); setReset(false); toast('Settings reset'); }} />
    </div>
  );
}
