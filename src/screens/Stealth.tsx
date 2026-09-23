import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../state/store';
import { formatTime } from '../ui/format';

interface StealthProps {
  onExit: () => void;
}

export function Stealth({ onExit }: StealthProps) {
  const s = useStore();
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exitCount, setExitCount] = useState(0);
  const [exitHint, setExitHint] = useState(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Acquire WakeLock to keep screen on
  useEffect(() => {
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await (navigator as Navigator & {wakeLock: {request(t:string):Promise<WakeLockSentinel>}}).wakeLock.request('screen');
        }
      } catch { /* WakeLock not supported — silent fail */ }
    };
    acquire();
    return () => { wakeLock.current?.release().catch(()=>undefined); };
  }, []);

  // Start recording if not already recording
  useEffect(() => {
    if (!s.recording) s.startRecording();
    setVisible(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed timer
  useEffect(() => {
    if (!s.recordStartedAt) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((Date.now() - s.recordStartedAt!) / 1000), 1000);
    return () => clearInterval(id);
  }, [s.recordStartedAt]);

  // Triple-tap to exit stealth
  const handleTap = useCallback(() => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    setExitCount((c) => {
      const next = c + 1;
      if (next >= 3) {
        setVisible(false);
        setTimeout(() => onExit(), 350);
        return 0;
      }
      if (next === 1) setExitHint(true);
      tapTimer.current = setTimeout(() => { setExitCount(0); setExitHint(false); }, 1400);
      return next;
    });
  }, [onExit]);

  // Dismiss exit hint after a moment
  useEffect(() => {
    if (!exitHint) return;
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => setExitHint(false), 2500);
  }, [exitHint]);

  return (
    <div
      className={`stealth${visible ? ' stealth--visible' : ''}`}
      onClick={handleTap}
      role="button"
      aria-label="Stealth recording — triple-tap to exit"
    >
      {/* Minimal status dot */}
      <div className={`stealth__dot${s.recording ? ' stealth__dot--rec' : ''}`} />

      {/* Faint timer */}
      {s.recording && (
        <div className="stealth__timer">{formatTime(elapsed)}</div>
      )}

      {/* Exit hint — only flashes on first tap */}
      {exitHint && (
        <div className="stealth__hint">
          {exitCount >= 2 ? 'One more…' : 'Triple-tap to exit'}
        </div>
      )}
    </div>
  );
}
