/* global AudioWorkletProcessor, registerProcessor */
// The recording AudioContext runs at 16 kHz. Send 100 ms PCM frames to the host.
class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.port.onmessage = () => this.flush(true);
  }
  flush(final = false) {
    if (!this.samples.length && !final) return;
    const data = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(data);
    this.samples.forEach((value, index) =>
      view.setInt16(
        index * 2,
        Math.round(
          Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767),
        ),
        true,
      ),
    );
    this.samples = [];
    this.port.postMessage({ data, final }, [data]);
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      this.samples.push(...input);
      if (this.samples.length >= 1600) this.flush();
    }
    return true;
  }
}
registerProcessor("speech-capture", SpeechCapture);
