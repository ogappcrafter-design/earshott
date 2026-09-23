import { useEffect, useRef, useState } from 'react';
import {
  FULL_VIEW, SourceTracker, fmtHz, fracToHz, hitTest, hzToFrac, panView, zoomView,
  type BandSource, type ScopeView, type Source, type VoiceSource,
} from '../audio/sources';
import type { LockTarget, MuteTarget } from '../audio/engine';

export interface ScopeSnapshot { voices: VoiceSource[]; bands: BandSource[] }

const ROWS = 720;          // full-range waterfall resolution
const STEP = 2;            // pixels scrolled per frame
const NICE = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000];

// plum → brass → mint heat map
const LUT = (() => {
  const stops: [number, [number, number, number]][] = [[0, [23, 17, 31]], [0.25, [70, 38, 70]], [0.5, [168, 116, 42]], [0.75, [242, 200, 107]], [1, [200, 255, 234]]];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [x0, c0] = stops[k], [x1, c1] = stops[k + 1]; const t = (x - x0) / (x1 - x0);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * t;
  }
  return out;
})();

export function Scope({ analyser, active, sensitivity, lock, mutes, selectedId, onSelect, onSnapshot }: {
  analyser: AnalyserNode | null; active: boolean; sensitivity: number;
  lock: LockTarget | null; mutes: MuteTarget[]; selectedId: string | null;
  onSelect: (s: Source | null) => void; onSnapshot: (s: ScopeSnapshot) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<ScopeView>(FULL_VIEW);
  const viewRef = useRef(view); viewRef.current = view;
  const live = useRef({ sensitivity, lock, mutes, selectedId, onSelect, onSnapshot });
  live.current = { sensitivity, lock, mutes, selectedId, onSelect, onSnapshot };
  const frameRef = useRef<ScopeSnapshot>({ voices: [], bands: [] });

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const off = document.createElement('canvas');
    const og = off.getContext('2d')!;
    const resize = () => {
      const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      if (off.width !== w) { off.width = w; off.height = ROWS; og.fillStyle = '#17111F'; og.fillRect(0, 0, w, ROWS); }
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);

    const tracker = analyser ? new SourceTracker(analyser.context.sampleRate, analyser.fftSize) : null;
    const db = new Float32Array(analyser?.frequencyBinCount ?? 1);
    const col = og.createImageData(STEP, ROWS);
    // precompute which FFT bins each waterfall row covers
    const sr = analyser?.context.sampleRate ?? 48000, fft = analyser?.fftSize ?? 8192;
    const rowBins = Array.from({ length: ROWS }, (_, y) => {
      const hzHi = fracToHz(1 - y / ROWS, FULL_VIEW), hzLo = fracToHz(1 - (y + 1) / ROWS, FULL_VIEW);
      const a = Math.max(1, Math.floor((hzLo * fft) / sr)), b = Math.max(a, Math.ceil((hzHi * fft) / sr));
      return [a, Math.min(db.length - 1, b)] as const;
    });
    let raf = 0; let lastPublish = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const W = cv.width, H = cv.height;
      const L = live.current;
      if (active && analyser && tracker) {
        tracker.sensitivity = L.sensitivity;
        analyser.getFloatFrequencyData(db);
        const f = tracker.update(db);
        frameRef.current = { voices: f.voices, bands: f.bands };
        const gain = 255 / (72 - L.sensitivity * 32); // more sensitive = quieter sounds glow brighter
        for (let y = 0; y < ROWS; y++) {
          const [a, b] = rowBins[y]; let m = 0;
          for (let k = a; k <= b; k++) if (f.excess[k] > m) m = f.excess[k];
          const v = Math.min(255, Math.round(m * gain));
          for (let x = 0; x < STEP; x++) {
            const p = (y * STEP + x) * 4;
            col.data[p] = LUT[v * 3]; col.data[p + 1] = LUT[v * 3 + 1]; col.data[p + 2] = LUT[v * 3 + 2]; col.data[p + 3] = 255;
          }
        }
        og.drawImage(off, -STEP, 0);
        og.putImageData(col, off.width - STEP, 0);
        if (now - lastPublish > 250) { lastPublish = now; L.onSnapshot(frameRef.current); }
      }
      const v = viewRef.current;
      const topF = hzToFrac(v.maxHz, FULL_VIEW), botF = hzToFrac(v.minHz, FULL_VIEW);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, (1 - topF) * ROWS, off.width, (topF - botF) * ROWS, 0, 0, W, H);
      const yOf = (hz: number) => (1 - hzToFrac(hz, v)) * H;

      // frequency grid
      g.font = `${11 * dpr}px Figtree, system-ui, sans-serif`; g.textBaseline = 'middle';
      for (const hz of NICE) {
        if (hz < v.minHz || hz > v.maxHz) continue;
        const y = yOf(hz);
        g.fillStyle = 'rgba(237,230,216,.08)'; g.fillRect(0, y, W, dpr);
        g.fillStyle = 'rgba(237,230,216,.5)'; g.fillText(`${fmtHz(hz)} Hz`, 6 * dpr, y - 8 * dpr);
      }
      // muted sounds
      for (const m of L.mutes) {
        const half = m.centerHz / m.q / 2; const y1 = yOf(m.centerHz + half), y2 = yOf(Math.max(20, m.centerHz - half));
        g.fillStyle = 'rgba(240,113,90,.14)'; g.fillRect(0, y1, W, Math.max(2 * dpr, y2 - y1));
      }
      // band sources: divider lines between sounds
      const { bands, voices } = frameRef.current;
      const labels: { y: number; text: string; color: string }[] = [];
      for (const b of bands) {
        const y1 = yOf(b.highHz), y2 = yOf(b.lowHz);
        if (y2 < 0 || y1 > H) continue;
        const sel = L.selectedId === b.id || (L.lock?.kind === 'band' && Math.abs(Math.log(L.lock.peakHz / b.peakHz)) < 0.15);
        if (sel) { g.fillStyle = 'rgba(126,242,200,.12)'; g.fillRect(0, y1, W, y2 - y1); }
        g.setLineDash([6 * dpr, 5 * dpr]); g.lineWidth = dpr * (sel ? 2 : 1.2);
        g.strokeStyle = sel ? 'rgba(126,242,200,.9)' : 'rgba(237,230,216,.55)';
        g.beginPath(); g.moveTo(0, y1); g.lineTo(W, y1); g.moveTo(0, y2); g.lineTo(W, y2); g.stroke();
        g.setLineDash([]);
        labels.push({ y: (Math.max(0, y1) + Math.min(H, y2)) / 2, text: `${b.label}  ${fmtHz(b.lowHz)}–${fmtHz(b.highHz)}`, color: sel ? '#7EF2C8' : 'rgba(237,230,216,.85)' });
      }
      // voice sources: glowing pitch tracks plus harmonic ticks
      for (const vo of voices) {
        const sel = L.selectedId === vo.id || (L.lock?.kind === 'voice' && Math.abs(Math.log(L.lock.medianHz / vo.medianHz)) < 0.1);
        const color = `hsl(${vo.hue} 85% 68%)`;
        g.strokeStyle = color; g.lineWidth = dpr * (sel ? 3.5 : 2.2); g.shadowColor = color; g.shadowBlur = sel ? 14 * dpr : 6 * dpr;
        g.beginPath(); let pen = false;
        const hist = vo.history;
        for (let i = 0; i < hist.length; i++) {
          const x = W - (hist.length - 1 - i) * STEP * (W / off.width);
          const hz = hist[i];
          if (hz === null) { pen = false; continue; }
          const y = yOf(hz);
          if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
        }
        g.stroke(); g.shadowBlur = 0;
        g.globalAlpha = 0.5;
        for (let h = 2; h <= 6; h++) { const y = yOf(vo.f0 * h); if (y > 0 && y < H) g.fillRect(W - 26 * dpr, y - dpr, 22 * dpr, 2 * dpr); }
        g.globalAlpha = 1;
        const yv = yOf(vo.f0);
        if (yv > 0 && yv < H) labels.push({ y: yv, text: `${vo.label}  ${Math.round(vo.f0)} Hz`, color });
      }
      // stack labels so they never overlap
      labels.sort((a, b) => a.y - b.y);
      const gap = 22 * dpr; let prev = -Infinity;
      for (const l of labels) { l.y = Math.max(l.y, prev + gap, 12 * dpr); prev = l.y; }
      for (let i = labels.length - 1, next = H - 12 * dpr + gap; i >= 0; i--) { labels[i].y = Math.min(labels[i].y, next - gap); next = labels[i].y; }
      for (const l of labels) {
        if (l.y < 0) continue;
        const tw = g.measureText(l.text).width + 12 * dpr;
        g.fillStyle = 'rgba(23,17,31,.8)'; g.fillRect(W - tw - 34 * dpr, l.y - 10 * dpr, tw, 20 * dpr);
        g.fillStyle = l.color; g.fillText(l.text, W - tw - 28 * dpr, l.y);
      }
      if (!active) {
        g.fillStyle = 'rgba(23,17,31,.55)'; g.fillRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [analyser, active]);

  // gestures: tap = select, drag = pan, pinch = zoom, double-tap = reset
  const pts = useRef(new Map<number, { x: number; y: number; t: number; sx: number; sy: number }>());
  const pinch = useRef<{ d: number; view: ScopeView; hz: number } | null>(null);
  const lastTap = useRef(0);
  const hzAt = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return fracToHz(1 - (clientY - r.top) / r.height, viewRef.current);
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), sx: e.clientX, sy: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, hz: hzAt((a.y + b.y) / 2) };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pts.current.get(e.pointerId); if (!p) return;
    const prevY = p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.d > 10) setView(zoomView(pinch.current.view, pinch.current.hz, d / pinch.current.d));
    } else if (pts.current.size === 1) {
      const h = ref.current!.getBoundingClientRect().height;
      setView((v) => panView(v, (e.clientY - prevY) / h));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const p = pts.current.get(e.pointerId);
    const wasPinch = pts.current.size > 1 || pinch.current !== null;
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = wasPinch && pts.current.size === 1 ? pinch.current : null;
    if (pts.current.size === 0) pinch.current = null;
    if (!p || wasPinch) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (moved < 10 && performance.now() - p.t < 350) {
      const now = performance.now();
      if (now - lastTap.current < 300) { setView(FULL_VIEW); lastTap.current = 0; return; }
      lastTap.current = now;
      live.current.onSelect(hitTest(frameRef.current, hzAt(e.clientY)));
    }
  };
  const center = Math.sqrt(view.minHz * view.maxHz);
  const zoomed = view.minHz > FULL_VIEW.minHz * 1.01 || view.maxHz < FULL_VIEW.maxHz * 0.99;

  return (
    <div className="scope">
      <canvas ref={ref} className="scope__canvas" onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp}
        role="img" aria-label="Live sound map. Tap a sound to select it, pinch to zoom, drag to scroll." />
      <div className="scope__zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setView(zoomView(view, center, 1.6))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setView(zoomView(view, center, 1 / 1.6))}>−</button>
        {zoomed && <button type="button" aria-label="Show all frequencies" onClick={() => setView(FULL_VIEW)}>⤢</button>}
      </div>
      <span className="scope__range">{fmtHz(view.minHz)}–{fmtHz(view.maxHz)} Hz</span>
    </div>
  );
}
