import { useState } from 'react';
import { WordArt } from '../ui/WordArt';
import { Button } from '../ui/Controls';
import { IconArchive, IconHeadphones, IconVoice } from '../ui/Icons';

const STEPS = [
  { art: <IconHeadphones size={64} />, title: 'Hear it', body: 'Earshot turns your phone into a personal sound amplifier. Plug in wired or USB-C earbuds for real-time listening. Bluetooth adds a delay you will notice.' },
  { art: <IconVoice size={64} />, title: 'Lock on', body: 'Teach Earshot a voice with a 20-second sample. Focus mode then lifts that voice’s range and lets the rest fall away.' },
  { art: <IconArchive size={64} />, title: 'Keep it', body: 'Recordings save as studio-quality WAV files with a best-guess transcript you can search, share and download.' },
];

export function Onboarding({ onFinish }: { onFinish: (runHearingCheck: boolean) => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length;
  return (
    <div className="onboard">
      <div className="onboard__dots" aria-hidden="true">
        {[...STEPS, null].map((_, k) => <span key={k} className={k === i ? 'is-on' : ''} />)}
      </div>
      {!last ? (
        <div className="onboard__panel" key={i}>
          <div className="onboard__art">{STEPS[i].art}</div>
          <WordArt text={STEPS[i].title} size={48} align="middle" />
          <p>{STEPS[i].body}</p>
          <div className="onboard__actions">
            {i > 0 && <Button variant="ghost" onClick={() => setI(i - 1)}>Back</Button>}
            <Button onClick={() => setI(i + 1)}>Next</Button>
          </div>
        </div>
      ) : (
        <div className="onboard__panel" key="final">
          <WordArt text="Tune to you" size={44} align="middle" />
          <p>A two-minute tone check builds an EQ curve for your ears. Put your earbuds in and find a quiet spot.</p>
          <p className="fine">Earshot is a sound amplifier, not a medical device or hearing test. If you notice hearing changes, see an audiologist.</p>
          <p className="fine">Recording laws vary by state. Ohio allows recording with one party’s consent, but some states require everyone’s. Ask first.</p>
          <div className="onboard__actions onboard__actions--stack">
            <Button onClick={() => onFinish(true)}>Start tone check</Button>
            <Button variant="ghost" onClick={() => onFinish(false)}>Skip for now</Button>
          </div>
        </div>
      )}
    </div>
  );
}
