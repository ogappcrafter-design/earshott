import { useEffect, useRef } from 'react';
import type { VoiceFocusTarget } from '../audio/engine';

/**
 * The signature visual: a circular spectrum "sieve". Frequencies in the locked voice's range glow
 * phosphor green; everything else falls through as brass dust.
 */
export function Sieve({ analyser, active, focus, focusAmount }: {
  analyser: AnalyserNode | null; active: boolean; focus: VoiceFocusTarget | null; focusAmount: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0; let t = 0;
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 1024);
    const particles: { a: number; r: number; v: number; life: number }[] = [];
    const BARS = 96;
    const resize = () => { const s = cv.clientWidth; cv.width = s * dpr; cv.height = s * dpr; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const sr = analyser?.context.sampleRate ?? 48000;
    const lo = focus ? focus.lowHz * 0.75 : 0; const hi = focus ? 4000 : 0;
    const draw = () => {
      t += 1;
      const W = cv.width, c = W / 2, R = W * 0.3;
      g.clearRect(0, 0, W, W);
      if (active && analyser) analyser.getByteFrequencyData(bins); else bins.fill(0);
      let energy = 0;
      for (let i = 0; i < BARS; i++) {
        const frac = i / BARS;
        const hz = 60 * Math.pow(16000 / 60, frac);
        const bin = Math.min(bins.length - 1, Math.round((hz / (sr / 2)) * bins.length));
        const v = active ? bins[bin] / 255 : 0.06 + 0.04 * Math.sin(t / 40 + i / 5);
        energy += v;
        const inFocus = focus && focusAmount > 0 && hz >= lo && hz <= hi;
        const ang = frac * Math.PI * 2 - Math.PI / 2;
        const len = W * 0.02 + v * W * 0.16;
        const x1 = c + Math.cos(ang) * R, y1 = c + Math.sin(ang) * R;
        const x2 = c + Math.cos(ang) * (R + len), y2 = c + Math.sin(ang) * (R + len);
        g.strokeStyle = inFocus ? `rgba(126,242,200,${0.45 + v * 0.55})` : `rgba(217,164,65,${0.25 + v * 0.6})`;
        g.lineWidth = W * 0.012; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        if (!reduced && active && !inFocus && v > 0.5 && Math.random() < 0.08 * focusAmount + 0.02) {
          particles.push({ a: ang, r: R + len, v: 0.6 + Math.random(), life: 1 });
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.r += p.v * dpr; p.life -= 0.02;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        g.fillStyle = `rgba(217,164,65,${p.life * 0.7})`;
        g.beginPath(); g.arc(c + Math.cos(p.a) * p.r, c + Math.sin(p.a) * p.r + (1 - p.life) * W * 0.05, W * 0.005, 0, Math.PI * 2); g.fill();
      }
      const e = energy / BARS;
      const core = R * (0.62 + e * 0.35 + (reduced ? 0 : 0.02 * Math.sin(t / 30)));
      const grad = g.createRadialGradient(c, c, 0, c, c, core);
      grad.addColorStop(0, active ? 'rgba(126,242,200,0.35)' : 'rgba(217,164,65,0.18)');
      grad.addColorStop(1, 'rgba(23,17,31,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(c, c, core, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(237,230,216,0.12)'; g.lineWidth = dpr;
      g.beginPath(); g.arc(c, c, R * 0.96, 0, Math.PI * 2); g.stroke();
      if (!reduced || active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [analyser, active, focus, focusAmount]);
  return <canvas ref={ref} className="sieve" aria-hidden="true" />;
}
