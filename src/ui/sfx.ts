/** Tiny synthesized UI sounds: no asset files, no licensing, near-zero size. */
let ctx: AudioContext | null = null;
let enabled = true;
export const setSfxEnabled = (on: boolean) => { enabled = on; };

function blip(freqs: number[], dur = 0.07, vol = 0.05, type: OscillatorType = 'sine') {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx!.createOscillator(); const g = ctx!.createGain();
      o.type = type; o.frequency.value = f;
      const t = t0 + i * dur * 0.8;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx!.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch { /* audio unavailable */ }
}
export const sfx = {
  tap: () => blip([880], 0.04, 0.025),
  on: () => blip([520, 780], 0.08),
  off: () => blip([780, 520], 0.08),
  success: () => blip([660, 880, 1320], 0.09, 0.04, 'triangle'),
  error: () => blip([220, 180], 0.12, 0.05, 'square'),
};
