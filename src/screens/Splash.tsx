import { useEffect } from 'react';
import { WordArt } from '../ui/WordArt';

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(onDone, reduced ? 600 : 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <div className="splash__rings" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ animationDelay: `${i * 0.45}s` }} />)}
      </div>
      <div className="splash__wave" aria-hidden="true">
        {Array.from({ length: 23 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${Math.abs(11 - i) * 0.06}s`, height: `${18 + Math.sin(i / 2.2) * 14 + (i % 3) * 6}px` }} />
        ))}
      </div>
      <WordArt text="Earshot" size={72} align="middle" animate />
      <p className="splash__tag">Hear the voice you came for.</p>
    </div>
  );
}
