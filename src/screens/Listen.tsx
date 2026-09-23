import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Sieve } from '../ui/Sieve';
import { WordArt } from '../ui/WordArt';
import { Confirm, Slider } from '../ui/Controls';
import { IconBookmark, IconHeadphones } from '../ui/Icons';
import { formatTime } from '../ui/format';
import { sfx } from '../ui/sfx';
import { Toggle } from '../ui/Controls';
import { IS_TESTER } from '../demo';

export function Listen({ toast }: { toast: (t: string, k?: 'ok' | 'err') => void }) {
  const s = useStore();
  const [elapsed, setElapsed] = useState(0);
  const [askHeadphones, setAskHeadphones] = useState(false);
  const e = s.settings.engine;

  useEffect(() => {
    if (!s.recordStartedAt) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((Date.now() - s.recordStartedAt!) / 1000), 250);
    return () => clearInterval(id);
  }, [s.recordStartedAt]);

  const monitor = () => {
    if (!s.monitoring && !s.settings.headphoneAck) { setAskHeadphones(true); return; }
    (s.monitoring ? sfx.off : sfx.on)();
    s.toggleMonitor();
  };
  const record = async () => {
    if (s.recording) { const r = await s.stopRecording(); if (r) toast(`Saved to your archive (${formatTime(r.durationSec)})`); }
    else { sfx.on(); await s.startRecording(); }
  };

  return (
    <div className="screen listen">
      <header className="screen__head">
        <WordArt text="Listen" />
        {s.activeVoice && e.voiceFocus > 0 && (
          <span className="chip" style={{ ['--hue' as string]: s.activeVoice.colorHue }}>Locked on {s.activeVoice.name}</span>
        )}
      </header>

      <div className="listen__stage">
        <Sieve analyser={s.engine.analyser} active={s.live} focus={s.activeVoice} focusAmount={e.voiceFocus} />
        <button type="button" className={`hear-btn${s.monitoring ? ' is-on' : ''}`} onClick={monitor}
          aria-pressed={s.monitoring} aria-label={s.monitoring ? 'Stop listening' : 'Start listening'}>
          <IconHeadphones size={36} />
          <span>{s.monitoring ? 'Listening' : 'Tap to hear'}</span>
        </button>
      </div>

      {s.error && <p className="banner banner--err" role="alert">{s.error}</p>}
      {s.notice && !s.error && <p className="banner">{s.notice}</p>}
      {IS_TESTER && (
        <div className="panel panel--tester">
          <Toggle label="Test signal" checked={s.usingTestSignal} onChange={(v) => s.setTestSignal(v)}
            hint="A fake noisy room with one talker. Flip Noise reduction and Clear speech on and off to hear the difference." />
        </div>
      )}

      <div className="rec-bar">
        <button type="button" className={`rec-btn${s.recording ? ' is-rec' : ''}`} onClick={record}
          aria-label={s.recording ? 'Stop recording' : 'Start recording'}><span /></button>
        <div className="rec-bar__info">
          <strong>{s.recording ? formatTime(elapsed) : 'Record'}</strong>
          <small>{s.recording ? `${s.bookmarks.length} bookmark${s.bookmarks.length === 1 ? '' : 's'}` : IS_TESTER ? `${s.settings.bitDepth}-bit WAV` : `${s.settings.bitDepth}-bit WAV with transcript`}</small>
        </div>
        {s.recording && (
          <button type="button" className="icon-btn" onClick={() => { sfx.tap(); s.addBookmark(); }} aria-label="Bookmark this moment">
            <IconBookmark />
          </button>
        )}
      </div>

      <section className="panel">
        <Slider label="Volume boost" value={e.volumeDb} min={0} max={30} onChange={(v) => s.setEngine({ volumeDb: v })} format={(v) => `+${v} dB`} />
        <Slider label="Noise reduction" value={Math.round(e.noiseReduction * 100)} min={0} max={100} step={5}
          onChange={(v) => s.setEngine({ noiseReduction: v / 100 })} format={(v) => `${v}%`} />
        {s.voices.length > 0 ? (
          <>
            <div className="voice-pick" role="radiogroup" aria-label="Voice to focus on">
              <button type="button" role="radio" aria-checked={!s.settings.activeVoiceId} className={!s.settings.activeVoiceId ? 'is-on' : ''}
                onClick={() => s.setSettings((x) => ({ ...x, activeVoiceId: null }))}>Anyone</button>
              {s.voices.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={s.settings.activeVoiceId === v.id}
                  className={s.settings.activeVoiceId === v.id ? 'is-on' : ''} style={{ ['--hue' as string]: v.colorHue }}
                  onClick={() => { s.setSettings((x) => ({ ...x, activeVoiceId: v.id })); if (e.voiceFocus === 0) s.setEngine({ voiceFocus: 0.7 }); }}>
                  {v.name}
                </button>
              ))}
            </div>
            {s.settings.activeVoiceId && (
              <Slider label="Focus strength" value={Math.round(e.voiceFocus * 100)} min={0} max={100} step={5}
                onChange={(v) => s.setEngine({ voiceFocus: v / 100 })} format={(v) => `${v}%`} />
            )}
          </>
        ) : <p className="fine">Add a voice on the Voices tab to unlock Focus mode.</p>}
      </section>

      <Confirm open={askHeadphones} title="Earbuds in?"
        body="Live listening through the phone speaker causes loud feedback squeal. Use wired or USB-C earbuds for the least delay."
        confirmLabel="They’re in" onCancel={() => setAskHeadphones(false)}
        onConfirm={() => { setAskHeadphones(false); s.setSettings((x) => ({ ...x, headphoneAck: true })); sfx.on(); s.toggleMonitor(); }} />
    </div>
  );
}
