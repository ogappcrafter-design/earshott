import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface TutorialStep {
  id: string;       // DOM element id to spotlight
  title: string;
  body: string;
  place: 'above' | 'below' | 'center';
}

const STEPS: TutorialStep[] = [
  { id:'tour-power',     title:'Start listening',    body:'Tap to power on the mic. Tap again to stop.',                     place:'above' },
  { id:'tour-gain',      title:'Amplify',            body:'Drag up. Boosts sound up to 80× louder than a normal ear hears.',  place:'above' },
  { id:'tour-nr',        title:'Clean the sound',    body:'Noise reduction + spectral filter strip background interference.',  place:'above' },
  { id:'tour-ghost',     title:'Ghost Save',         body:'Saves the last 30 s — even if you forgot to hit Record.',         place:'above' },
  { id:'tour-vad',       title:'Trip Wire',          body:'Auto-records when it hears something. Stops when it goes quiet.',  place:'above' },
  { id:'tour-soundmap',  title:'Sound Map',          body:'See every sound live. Tap a source to isolate or mute it.',       place:'below' },
  { id:'tour-stealth',   title:'Stealth Mode',       body:'Screen goes black. Invisible operation. Still recording.',        place:'above' },
  { id:'tour-archive',   title:'Your archive',       body:'Every recording lives here, with a full searchable transcript.',  place:'above' },
];

interface Rect { top:number; left:number; width:number; height:number }
const EMPTY_RECT: Rect = { top:0, left:0, width:0, height:0 };

interface TutorialProps {
  onDone: () => void;
}

export function Tutorial({ onDone }: TutorialProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect>(EMPTY_RECT);
  const [ready, setReady] = useState(false);
  const animRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const current = STEPS[step];

  // Measure target element
  useLayoutEffect(() => {
    setReady(false);
    const el = document.getElementById(current.id);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top:r.top-8, left:r.left-8, width:r.width+16, height:r.height+16 });
      el.scrollIntoView({ behavior:'smooth', block:'center' });
    } else {
      setRect(EMPTY_RECT);
    }
    if (animRef.current) clearTimeout(animRef.current);
    animRef.current = setTimeout(()=>setReady(true), 200);
  }, [step, current.id]);

  const next = useCallback(()=>{
    if (step < STEPS.length-1) setStep((s)=>s+1);
    else onDone();
  }, [step, onDone]);

  const back = useCallback(()=>{ if(step>0) setStep((s)=>s-1); }, [step]);

  // Tooltip position
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const GAP = 16;
  const CARD_H = 180;
  let cardTop = current.place==='above' ? rect.top-CARD_H-GAP : rect.top+rect.height+GAP;
  if (current.place==='center') cardTop = vp.h/2 - CARD_H/2;
  cardTop = Math.max(GAP, Math.min(vp.h-CARD_H-GAP, cardTop));

  return (
    <div className="tutorial" role="dialog" aria-modal="true" aria-label="Earshot walkthrough">
      {/* Dark overlay with spotlight hole */}
      <div
        className={`tutorial__mask${ready?' tutorial__mask--ready':''}`}
        style={{
          '--spot-top':   `${rect.top}px`,
          '--spot-left':  `${rect.left}px`,
          '--spot-w':     `${rect.width}px`,
          '--spot-h':     `${rect.height}px`,
        } as React.CSSProperties}
        onClick={next}
      />

      {/* Pulsing spotlight ring */}
      {ready && rect.width > 0 && (
        <div className="tutorial__ring" style={{
          top:    rect.top-4,
          left:   rect.left-4,
          width:  rect.width+8,
          height: rect.height+8,
        }} />
      )}

      {/* Tooltip card */}
      <div
        className={`tutorial__card${ready?' tutorial__card--ready':''}`}
        style={{ top:cardTop, left:GAP, right:GAP }}
        onClick={(e)=>e.stopPropagation()}
      >
        <div className="tutorial__progress">
          {STEPS.map((_,i)=>(
            <span key={i} className={`tutorial__dot${i===step?' is-on':i<step?' is-done':''}`} />
          ))}
        </div>
        <strong className="tutorial__title">{current.title}</strong>
        <p className="tutorial__body">{current.body}</p>
        <div className="tutorial__nav">
          {step > 0
            ? <button type="button" className="btn btn--ghost tutorial__back" onClick={back}>Back</button>
            : <span />
          }
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="linkbtn tutorial__skip" onClick={onDone}>Skip</button>
            <button type="button" className="btn btn--primary" onClick={next}>
              {step===STEPS.length-1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Show element count for a given step (used by UI elements to set their id). */
export const TUTORIAL_IDS = Object.fromEntries(STEPS.map((s)=>[s.id,s.id])) as Record<string,string>;
