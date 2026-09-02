interface SpeechCaptureWorkletOptions {
  readonly processorOptions?: {
    readonly sourceSampleRateHz?: number;
    readonly targetSampleRateHz?: number;
    readonly maxSamples?: number;
    readonly batchSamples?: number;
    readonly rmsThreshold?: number;
  };
}

interface SpeechCaptureWorkletControlMessage {
  readonly kind?: string;
  readonly requestId?: string;
}

const defaultTargetSampleRateHz = 16_000;
const defaultBatchSamples = 800;
const defaultMaxSamples = defaultTargetSampleRateHz * 10 * 60;
const defaultRmsThreshold = 0.012;

class ForgerieSpeechCaptureProcessor extends AudioWorkletProcessor {
  private readonly sourceSampleRateHz: number;
  private readonly targetSampleRateHz: number;
  private readonly maxSamples: number;
  private readonly batchSamples: number;
  private readonly rmsThreshold: number;
  private readonly batch: Float32Array;
  private batchLength = 0;
  private batchEnergy = 0;
  private totalOutputSamples = 0;
  private sourceAccumulator = 0;
  private sourceAccumulatorCount = 0;
  private sourceStep = 1;
  private sourceStepProgress = 0;
  private liveInputReported = false;
  private terminal = false;

  public constructor(options?: SpeechCaptureWorkletOptions) {
    super(options);
    const processorOptions = options?.processorOptions;
    this.sourceSampleRateHz = finitePositive(processorOptions?.sourceSampleRateHz) ?? sampleRate;
    this.targetSampleRateHz = finitePositive(processorOptions?.targetSampleRateHz) ?? defaultTargetSampleRateHz;
    this.maxSamples = Math.max(0, Math.floor(finitePositive(processorOptions?.maxSamples) ?? defaultMaxSamples));
    this.batchSamples = Math.max(1, Math.floor(finitePositive(processorOptions?.batchSamples) ?? defaultBatchSamples));
    this.rmsThreshold = finitePositive(processorOptions?.rmsThreshold) ?? defaultRmsThreshold;
    this.batch = new Float32Array(this.batchSamples);
    this.sourceStep = Math.max(1, this.sourceSampleRateHz / this.targetSampleRateHz);
    this.port.onmessage = (event: MessageEvent<SpeechCaptureWorkletControlMessage>) => {
      if (event.data.kind === "flush" && event.data.requestId !== undefined) this.flushAndAcknowledge(event.data.requestId);
    };
  }

  public override process(inputs: Float32Array[][]): boolean {
    if (this.terminal) return false;
    const channel = inputs[0]?.[0];
    if (channel === undefined || channel.length === 0) return true;
    this.reportLiveInputOnce();
    for (const sample of channel) {
      if (this.totalOutputSamples >= this.maxSamples) {
        this.reportLimitOnce();
        return false;
      }
      if (!this.acceptSourceSample(sample)) return false;
    }
    return true;
  }

  private reportLiveInputOnce(): void {
    if (this.liveInputReported) return;
    this.liveInputReported = true;
    this.port.postMessage({ kind: "live" });
  }

  private acceptSourceSample(sample: number): boolean {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    if (this.sourceSampleRateHz <= this.targetSampleRateHz) return this.pushOutputSample(clamped);
    this.sourceAccumulator += clamped;
    this.sourceAccumulatorCount += 1;
    this.sourceStepProgress += 1;
    if (this.sourceStepProgress < this.sourceStep) return true;
    const averaged = this.sourceAccumulator / Math.max(1, this.sourceAccumulatorCount);
    this.sourceAccumulator = 0;
    this.sourceAccumulatorCount = 0;
    this.sourceStepProgress -= this.sourceStep;
    return this.pushOutputSample(averaged);
  }

  private pushOutputSample(sample: number): boolean {
    if (this.totalOutputSamples >= this.maxSamples) {
      this.reportLimitOnce();
      return false;
    }
    this.batch[this.batchLength] = sample;
    this.batchLength += 1;
    this.batchEnergy += sample * sample;
    this.totalOutputSamples += 1;
    if (this.batchLength >= this.batchSamples) this.flushBatch();
    return !this.terminal;
  }

  private flushBatch(): void {
    if (this.batchLength === 0) return;
    const samples = new Float32Array(this.batchLength);
    samples.set(this.batch.subarray(0, this.batchLength));
    const endSample = this.totalOutputSamples;
    const startSample = endSample - this.batchLength;
    const rms = Math.sqrt(this.batchEnergy / this.batchLength);
    this.port.postMessage({ kind: "batch", startSample, endSample, samples, rms, voiced: rms >= this.rmsThreshold }, [samples.buffer]);
    this.batchLength = 0;
    this.batchEnergy = 0;
  }

  private flushAndAcknowledge(requestId: string): void {
    this.flushBatch();
    this.port.postMessage({ kind: "flushed", requestId, totalSamples: this.totalOutputSamples });
  }

  private reportLimitOnce(): void {
    if (this.terminal) return;
    this.flushBatch();
    this.terminal = true;
    this.port.postMessage({ kind: "limit", totalSamples: this.totalOutputSamples });
    this.clearBatch();
  }

  private clearBatch(): void {
    this.batchLength = 0;
    this.batchEnergy = 0;
  }
}

function finitePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

registerProcessor("forgerie-speech-capture", ForgerieSpeechCaptureProcessor);

export {};
