import { useEffect, useRef, useState } from 'react';
import { playTone } from '../audio/engine';
import { TEST_FREQS, TEST_LEVELS, thresholdsToEq } from '../audio/hearing';
import { Button } from '../ui/Controls';
import { WordArt } from '../ui/WordArt';
import { EQ_BANDS, formatHz } from '../audio/eq';

export function HearingCheck({ onDone, onCancel }: { onDone: (eq: number[]) => void; onCancel: () => void }) {
  const [fi, setFi] = useState(0);
  const [li, setLi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [results, setResults] = useState<Record<number, number | null>>({});
  const [done, setDone] = useState<number[] | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const lastHeard = useRef<number | null>(null);

  useEffect(() => () => { ctx.current?.close().catch(() => undefined); }, []);

  const play = async () => {
    ctx.current ??= new AudioContext();
    await ctx.current.resume();
    setPlaying(true);
    await playTone(ctx.current, TEST_FREQS[fi], TEST_LEVELS[li]);
    setPlaying(false);
  };

  useEffect(() => { if (!done) play(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fi, li]);

  const answer = (heard: boolean) => {
    if (heard) lastHeard.current = TEST_LEVELS[li];
    if (heard && li < TEST_LEVELS.length - 1) { setLi(li + 1); return; }
    const next = { ...results, [TEST_FREQS[fi]]: lastHeard.current };
    setResults(next);
    lastHeard.current = null;
    if (fi < TEST_FREQS.length - 1) { setFi(fi + 1); setLi(0); }
    else setDone(thresholdsToEq(next));
  };

  const progress = ((fi + (done ? 1 : 0)) / TEST_FREQS.length) * 100;

  if (done) {
    return (
      <div className="screen screen--center">
        <WordArt text="Your curve" size={44} align="middle" />
        <div className="curve">
          {done.map((g, i) => (
            <div key={i} className="curve__bar"><span style={{ height: `${10 + (g / 15) * 90}%` }} /><small>{formatHz(EQ_BANDS[i])}</small></div>
          ))}
        </div>
        <p>Taller bars get more boost. You can fine-tune any band on the Tune tab.</p>
        <Button onClick={() => onDone(done)}>Use my curve</Button>
      </div>
    );
  }
  return (
    <div className="screen screen--center">
      <WordArt text="Tone check" size={44} align="middle" />
      <div className="progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className={`tone-orb${playing ? ' is-playing' : ''}`} aria-hidden="true"><span>{formatHz(TEST_FREQS[fi])}Hz</span></div>
      <p>{playing ? 'Listen…' : 'Did you hear the tone?'}</p>
      <div className="onboard__actions">
        <Button variant="ghost" disabled={playing} onClick={() => answer(false)}>No</Button>
        <Button disabled={playing} onClick={() => answer(true)}>Yes, I heard it</Button>
      </div>
      <button type="button" className="linkbtn" disabled={playing} onClick={play}>Play again</button>
      <button type="button" className="linkbtn" onClick={onCancel}>Skip the tone check</button>
    </div>
  );
}
