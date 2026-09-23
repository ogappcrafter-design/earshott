import { useState } from 'react';
import { recordRaw } from '../audio/engine';
import { analyzeVoice } from '../audio/pitch';
import { deleteVoice, newId, saveVoice, type VoiceProfile } from '../storage/db';
import { useStore } from '../state/store';
import { WordArt } from '../ui/WordArt';
import { Button, Confirm, EmptyState } from '../ui/Controls';
import { IconPlus, IconTrash, IconVoice } from '../ui/Icons';

const SECONDS = 20;
const PROMPT = 'Read this out loud at a normal pace: “The old lantern swung in the wind while we walked home. Every step crunched on the gravel, and somewhere past the trees a dog kept barking at nothing.” Keep talking about your day until the timer ends.';

export function Voices({ toast }: { toast: (t: string, k?: 'ok' | 'err') => void }) {
  const s = useStore();
  const [mode, setMode] = useState<'list' | 'name' | 'record'>('list');
  const [name, setName] = useState('');
  const [level, setLevel] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [del, setDel] = useState<VoiceProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    if (s.live) await s.stopLive();
    setMode('record'); setBusy(true); setLeft(SECONDS);
    const started = Date.now();
    const timer = setInterval(() => setLeft(Math.max(0, SECONDS - Math.floor((Date.now() - started) / 1000))), 250);
    try {
      const { samples, sampleRate } = await recordRaw(SECONDS, setLevel);
      const stats = analyzeVoice(samples, sampleRate);
      if (!stats || stats.voicedRatio < 0.15) {
        toast('Not enough talking was picked up. Hold the phone closer and try again.', 'err'); setMode('name'); return;
      }
      const v: VoiceProfile = { id: newId(), name: name.trim(), medianHz: stats.medianHz, lowHz: stats.lowHz, highHz: stats.highHz,
        createdAt: Date.now(), colorHue: Math.floor(Math.random() * 360) };
      await saveVoice(v); await s.refresh();
      s.setSettings((x) => ({ ...x, activeVoiceId: v.id, engine: { ...x.engine, voiceFocus: Math.max(0.7, x.engine.voiceFocus) } }));
      toast(`${v.name} is ready to lock on`); setMode('list'); setName('');
    } catch {
      toast('The microphone could not start. Check the permission in Android Settings.', 'err'); setMode('name');
    } finally { clearInterval(timer); setBusy(false); setLevel(0); }
  };

  if (mode === 'name') return (
    <div className="screen">
      <header className="screen__head"><WordArt text="New voice" /></header>
      <label className="field"><span>Whose voice is this?</span>
        <input value={name} maxLength={24} autoFocus placeholder="Mom, Professor Hale, Me…" onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="fine">That person should do the talking for the next {SECONDS} seconds. Only record voices with their okay.</p>
      <div className="onboard__actions">
        <Button variant="ghost" onClick={() => setMode('list')}>Cancel</Button>
        <Button disabled={!name.trim()} onClick={begin}>Start sample</Button>
      </div>
    </div>
  );

  if (mode === 'record') return (
    <div className="screen screen--center">
      <WordArt text="Keep talking" size={40} align="middle" />
      <div className="enroll-orb" style={{ ['--lvl' as string]: level }} aria-hidden="true"><span>{left}</span></div>
      <p className="prompt">{PROMPT}</p>
      {busy && <p className="fine">Recording {name}…</p>}
    </div>
  );

  return (
    <div className="screen">
      <header className="screen__head"><WordArt text="Voices" /></header>
      {s.voices.length === 0 ? (
        <EmptyState art={<IconVoice size={56} />} title="No voices yet"
          body="Record a 20-second sample of someone you want to hear clearly. Focus mode tunes Earshot to their voice."
          action={<Button icon={<IconPlus />} onClick={() => setMode('name')}>Add a voice</Button>} />
      ) : (
        <>
          <ul className="list">
            {s.voices.map((v) => (
              <li key={v.id} className="card voice-card" style={{ ['--hue' as string]: v.colorHue }}>
                <span className="voice-card__dot" aria-hidden="true" />
                <div className="voice-card__main">
                  <strong>{v.name}</strong>
                  <small>Voice range {Math.round(v.lowHz)}–{Math.round(v.highHz)} Hz</small>
                </div>
                {s.settings.activeVoiceId === v.id && <span className="chip">Active</span>}
                <button type="button" className="icon-btn" aria-label={`Delete ${v.name}`} onClick={() => setDel(v)}><IconTrash /></button>
              </li>
            ))}
          </ul>
          {s.voices.length < 5 && <Button icon={<IconPlus />} onClick={() => setMode('name')}>Add a voice</Button>}
        </>
      )}
      <Confirm open={!!del} title={`Delete ${del?.name ?? ''}?`} body="Their voice sample is removed. Recordings stay in your archive."
        confirmLabel="Delete voice" danger onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteVoice(del.id);
          if (s.settings.activeVoiceId === del.id) s.setSettings((x) => ({ ...x, activeVoiceId: null }));
          await s.refresh(); toast('Voice deleted'); setDel(null);
        }} />
    </div>
  );
}
