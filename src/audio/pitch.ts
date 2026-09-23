/** YIN fundamental-frequency estimator. Returns Hz, or null when the frame is unvoiced. */
export function detectPitch(frame: Float32Array, sampleRate: number, minHz = 60, maxHz = 500, threshold = 0.12): number | null {
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (Math.sqrt(energy / frame.length) < 0.01) return null;
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const d = new Float32Array(maxLag + 1);
  const W = frame.length - maxLag;
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = frame[i] - frame[i + tau]; s += x * x; }
    d[tau] = s;
  }
  let running = 0;
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const a = cmnd[tau - 1] ?? cmnd[tau], b = cmnd[tau], c = cmnd[tau + 1] ?? cmnd[tau];
  const denom = a - 2 * b + c;
  const refined = denom !== 0 ? tau + (a - c) / (2 * denom) : tau;
  return sampleRate / refined;
}

export interface VoicePitchStats {
  medianHz: number;
  lowHz: number;
  highHz: number;
  voicedRatio: number;
}

/** Summarize a recording's pitch contour into a voice profile (10th–90th percentile range). */
export function analyzeVoice(samples: Float32Array, sampleRate: number, frameSize = 2048, hop = 1024): VoicePitchStats | null {
  const pitches: number[] = [];
  let frames = 0;
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    frames++;
    const p = detectPitch(samples.subarray(start, start + frameSize), sampleRate);
    if (p !== null) pitches.push(p);
  }
  if (pitches.length < 5) return null;
  pitches.sort((x, y) => x - y);
  const q = (f: number) => pitches[Math.min(pitches.length - 1, Math.floor(f * pitches.length))];
  return { medianHz: q(0.5), lowHz: q(0.1), highHz: q(0.9), voicedRatio: pitches.length / frames };
}
