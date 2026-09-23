/** Linear-interpolation resample to 16 kHz mono for Whisper. Pure so it runs in tests and workers. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  // simple anti-alias: average across the source span each output sample covers
  for (let i = 0; i < outLen; i++) {
    const startF = i * ratio, endF = startF + ratio;
    const s = Math.floor(startF), e = Math.min(input.length, Math.ceil(endF));
    let sum = 0, n = 0;
    for (let j = s; j < e; j++) { sum += input[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Decode a WAV blob back to float samples (used before transcription). */
export async function decodeWavBlob(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await blob.arrayBuffer();
  const v = new DataView(buf);
  const numCh = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  let off = 12;
  let dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    const size = v.getUint32(off + 4, true);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error('This file has no audio data.');
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * numCh));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < numCh; c++) {
      const p = dataOff + (i * numCh + c) * bps;
      if (bits === 16) s += v.getInt16(p, true) / 0x8000;
      else { let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (x & 0x800000) x |= ~0xffffff; s += x / 0x800000; }
    }
    out[i] = s / numCh;
  }
  return { samples: out, sampleRate };
}
