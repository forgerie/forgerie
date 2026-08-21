// PROTOTYPE microphone worklet: downsample to 16 kHz mono and post 50 ms batches.
// Simplified from src/client/src/speechCaptureWorklet.ts (no backpressure protocol).

const TARGET_RATE = 16000;
const BATCH_SAMPLES = 800;

class VoiceContentCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    const sourceRate = options?.processorOptions?.sourceSampleRateHz ?? sampleRate;
    this.step = Math.max(1, sourceRate / TARGET_RATE);
    this.batch = new Float32Array(BATCH_SAMPLES);
    this.length = 0;
    this.energy = 0;
    this.accumulator = 0;
    this.accumulated = 0;
    this.progress = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel === undefined || channel.length === 0) return true;
    for (const raw of channel) {
      const sample = Math.max(-1, Math.min(1, Number.isFinite(raw) ? raw : 0));
      if (this.step <= 1) {
        this.push(sample);
        continue;
      }
      this.accumulator += sample;
      this.accumulated += 1;
      this.progress += 1;
      if (this.progress < this.step) continue;
      const averaged = this.accumulator / Math.max(1, this.accumulated);
      this.accumulator = 0;
      this.accumulated = 0;
      this.progress -= this.step;
      this.push(averaged);
    }
    return true;
  }

  push(sample) {
    this.batch[this.length] = sample;
    this.length += 1;
    this.energy += sample * sample;
    if (this.length < BATCH_SAMPLES) return;
    const samples = new Float32Array(this.batch.subarray(0, this.length));
    const rms = Math.sqrt(this.energy / this.length);
    this.length = 0;
    this.energy = 0;
    this.port.postMessage({ samples, rms }, [samples.buffer]);
  }
}

registerProcessor("voice-content-capture", VoiceContentCaptureProcessor);
