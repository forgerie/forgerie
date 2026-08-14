import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface ProcessorInstance {
  readonly port: RecordingPort;
  process(inputs: Float32Array[][]): boolean;
}

type ProcessorConstructor = new (options?: AudioWorkletNodeOptions) => ProcessorInstance;

class RecordingPort {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public readonly posted: unknown[] = [];

  public postMessage(message: unknown): void {
    this.posted.push(message);
  }

  public emit(message: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }
}

let registeredProcessorCtor: ProcessorConstructor | undefined;

describe("speech capture worklet protocol", () => {
  beforeAll(async () => {
    vi.stubGlobal("sampleRate", 16_000);
    vi.stubGlobal("AudioWorkletProcessor", class {
      public readonly port = new RecordingPort();
    });
    vi.stubGlobal("registerProcessor", (_name: string, ctor: ProcessorConstructor): void => {
      registeredProcessorCtor = ctor;
    });
    await import("./speechCaptureWorklet");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("flushes a partial batch and acknowledges the request ID", () => {
    const processor = createProcessor({ batchSamples: 4, maxSamples: 10 });

    expect(processor.process([[new Float32Array([0.1, 0.2])]])).toBe(true);
    expect(processor.port.posted.map(messageKind)).toEqual([]);

    processor.port.emit({ kind: "flush", requestId: "flush-1" });

    expect(processor.port.posted.map(messageKind)).toEqual(["batch", "flushed"]);
    expect(messageProperty(processor.port.posted[1], "requestId")).toBe("flush-1");
  });

  it("reports overflow instead of dropping an unacknowledged batch", () => {
    const processor = createProcessor({ batchSamples: 2, maxOutstandingBatches: 1, maxSamples: 10 });

    expect(processor.process([[new Float32Array([0.1, 0.1])]])).toBe(true);
    expect(processor.process([[new Float32Array([0.2, 0.2])]])).toBe(false);

    expect(processor.port.posted.map(messageKind)).toEqual(["batch", "overflow"]);
  });

  it("flushes the final partial batch before the terminal limit message", () => {
    const processor = createProcessor({ batchSamples: 8, maxSamples: 3 });

    expect(processor.process([[new Float32Array([0.1, 0.2, 0.3])]])).toBe(true);
    expect(processor.process([[new Float32Array([0.4])]])).toBe(false);

    expect(processor.port.posted.map(messageKind)).toEqual(["batch", "limit"]);
  });

  it("downsamples 48 kHz input to averaged 16 kHz output samples", () => {
    const processor = createProcessor({ sourceSampleRateHz: 48_000, targetSampleRateHz: 16_000, batchSamples: 2, maxSamples: 2, rmsThreshold: 0.1 });

    expect(processor.process([[new Float32Array([0, 0.3, 0.6, 0.9, -0.3, -0.6])]])).toBe(true);
    expect(processor.process([[new Float32Array([0.5, 0.5, 0.5])]])).toBe(false);

    const batch = processor.port.posted[0];
    expect(processor.port.posted.map(messageKind)).toEqual(["batch", "limit"]);
    expect(messageProperty(batch, "startSample")).toBe(0);
    expect(messageProperty(batch, "endSample")).toBe(2);
    const samples = messageProperty(batch, "samples");
    if (!(samples instanceof Float32Array)) throw new Error("Expected downsampled Float32Array");
    expect(samples[0]).toBeCloseTo(0.3);
    expect(samples[1]).toBeCloseTo(0);
    expect(messageProperty(batch, "rms")).toBeCloseTo(Math.sqrt((0.3 * 0.3) / 2));
    expect(messageProperty(batch, "voiced")).toBe(true);
    expect(messageProperty(processor.port.posted[1], "totalSamples")).toBe(2);
  });
});

function createProcessor(processorOptions: Record<string, number>): ProcessorInstance {
  if (registeredProcessorCtor === undefined) throw new Error("speech capture processor was not registered");
  return new registeredProcessorCtor({ processorOptions: { sourceSampleRateHz: 16_000, targetSampleRateHz: 16_000, ...processorOptions } });
}

function messageKind(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["kind"] === "string" ? value["kind"] : undefined;
}

function messageProperty(value: unknown, property: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[property];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
