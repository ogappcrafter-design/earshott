/**
 * AudioWorklet processors, loaded from a Blob URL so they bundle cleanly in the WebView.
 * - earshot-gate: adaptive downward expander. Tracks the noise floor and pulls audio below it down.
 * - earshot-capture: forwards processed mono audio to the main thread for recording and metering.
 */
export const WORKLET_SOURCE = `
class EarshotGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.env = 0; this.floor = 0.002; this.gain = 1;
    this.attack = Math.exp(-1 / (0.003 * sampleRate));
    this.release = Math.exp(-1 / (0.08 * sampleRate));
    this.floorUp = Math.exp(-1 / (4 * sampleRate));
    this.floorDown = Math.exp(-1 / (0.4 * sampleRate));
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || input.length === 0) return true;
    const amount = params.amount[0];
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]));
      const coef = peak > this.env ? this.attack : this.release;
      this.env = coef * this.env + (1 - coef) * peak;
      const fc = this.env > this.floor ? this.floorUp : this.floorDown;
      this.floor = Math.max(1e-5, fc * this.floor + (1 - fc) * this.env);
      const openAt = this.floor * (2 + amount * 4);
      let target = 1;
      if (this.env < openAt) {
        const ratio = Math.max(0, this.env / openAt);
        target = Math.pow(ratio, 1 + amount * 3);
        target = Math.max(target, 1 - amount * 0.97);
      }
      const gc = target < this.gain ? 0.995 : 0.9;
      this.gain = gc * this.gain + (1 - gc) * target;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor('earshot-gate', EarshotGate);

class EarshotCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buf = new Float32Array(4096); this.len = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.recording = true; this.len = 0; }
      if (e.data === 'stop') { this.flush(); this.recording = false; this.port.postMessage({ type: 'stopped' }); }
    };
  }
  flush() {
    if (this.len > 0) { this.port.postMessage({ type: 'chunk', data: this.buf.slice(0, this.len) }); this.len = 0; }
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c][i];
      this.buf[this.len++] = s / input.length;
      if (this.len === this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor('earshot-capture', EarshotCapture);
`;
