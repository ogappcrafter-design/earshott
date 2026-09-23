/**
 * Synthetic "noisy room" scene for the tester build when the microphone is unavailable:
 * a vowel-like talker (pitch contour + formants + syllable rhythm) over babble, hum and clatter.
 * Lets you hear what EQ, noise reduction and voice focus actually do.
 */
export function makeDemoScene(sampleRate: number, seconds = 8): Float32Array<ArrayBuffer> {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  // talker: glottal pulses through three formant resonators
  const formants = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480]];
  const res = [0, 1, 2].map(() => ({ y1: 0, y2: 0 }));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const syl = Math.floor(t * 4);
    const vowel = formants[syl % formants.length];
    const inSyl = (t * 4) % 1;
    const talking = (Math.floor(t / 2.5) % 3) !== 2; // pauses between phrases
    const env = talking ? Math.sin(Math.PI * Math.min(1, inSyl * 1.2)) ** 0.7 : 0;
    const f0 = 165 + 35 * Math.sin(t * 1.7) + 15 * Math.sin(t * 5.3);
    phase += f0 / sampleRate;
    let src = 0;
    if (phase >= 1) { phase -= 1; src = 1; }
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const f = vowel[k], bw = 90 + k * 40;
      const r = Math.exp(-Math.PI * bw / sampleRate);
      const c = 2 * r * Math.cos(2 * Math.PI * f / sampleRate);
      const y = (1 - r) * src + c * res[k].y1 - r * r * res[k].y2;
      res[k].y2 = res[k].y1; res[k].y1 = y;
      v += y / (k + 1);
    }
    out[i] = v * env * 2.2;
  }
  // babble noise: brown-ish noise with slow swells
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = 0.985 * b + 0.06 * rnd();
    const swell = 0.6 + 0.4 * Math.sin((i / sampleRate) * 0.9);
    out[i] += b * 0.35 * swell + rnd() * 0.012 + 0.03 * Math.sin((2 * Math.PI * 60 * i) / sampleRate);
  }
  // clatter: short bright clicks
  for (let k = 0; k < seconds * 1.5; k++) {
    const at = Math.floor(Math.abs(rnd()) * (n - 2000));
    for (let j = 0; j < 1500; j++) out[at + j] += rnd() * 0.25 * Math.exp(-j / 180);
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = 0.7 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= norm;
  return out;
}
