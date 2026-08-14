import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpeechCaptureError,
  SpeechChunkDeque,
  SpeechPauseCandidateDetector,
  createSpeechCaptureSession,
  mapSpeechCaptureFailure,
  type SpeechAudioContextLike,
  type SpeechAudioNodeLike,
  type SpeechAudioWorkletNodeLike,
  type SpeechBiquadFilterLike,
  type SpeechCaptureBrowserHost,
  type SpeechCaptureControlMessage,
  type SpeechCaptureMessage,
  type SpeechCaptureTerminal,
  type SpeechGainNodeLike,
  type SpeechMediaStreamLike,
  type SpeechMediaTrackLike,
} from "./speechCapture";

describe("speech capture DSP", () => {
  it("stores full-turn samples once and exposes logical latest-window views", () => {
    const deque = new SpeechChunkDeque(6);
    deque.push(new Float32Array([1, 2, 3]), 0);
    deque.push(new Float32Array([4, 5, 6]), 3);
    deque.push(new Float32Array([7, 8]), 6);

    expect([...deque.flattenAll()]).toEqual([3, 4, 5, 6, 7, 8]);
    expect([...deque.flattenLatest(4)]).toEqual([5, 6, 7, 8]);
    expect(deque.totalSamples).toBe(6);
  });

  it("retains the latest samples after many trims without shifting the public sequence", () => {
    const deque = new SpeechChunkDeque(6);
    for (let index = 0; index < 320; index += 1) deque.push(new Float32Array([index]), index);

    expect([...deque.flattenAll()]).toEqual([314, 315, 316, 317, 318, 319]);
    expect([...deque.flattenLatest(3)]).toEqual([317, 318, 319]);
    expect(deque.totalSamples).toBe(6);
  });

  it("emits one pause candidate from audio-frame time after speech and configured silence", () => {
    const detector = new SpeechPauseCandidateDetector({
      sampleRateHz: 16_000,
      pauseAfterSpeechMs: 650,
      minNewVoicedAudioMs: 650,
      minIntervalMs: 900,
    });

    expect(detector.accept(batch(0, 0.02, 200))).toBeUndefined();
    expect(detector.accept(batch(200, 0.001, 600))).toBeUndefined();
    expect(detector.accept(batch(800, 0.001, 10_600))).toMatchObject({ endSample: 11_400, voicedAtSample: 200 });
    expect(detector.accept(batch(11_400, 0.001, 10_600))).toBeUndefined();
    expect(detector.accept(batch(22_000, 0.03, 11_200))).toBeUndefined();
    expect(detector.accept(batch(33_200, 0.001, 10_600))).toMatchObject({ endSample: 43_800 });
  });
});

describe("speech capture browser lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("requests the microphone immediately from the trusted caller with mono processing preferences", async () => {
    const host = fakeHost();
    const promise = createSpeechCaptureSession({ host });

    expect(host.getUserMediaCalls).toHaveLength(1);
    expect(host.getUserMediaCalls[0]).toEqual({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const session = await promise;
    expect(session.actualSampleRateHz).toBe(48_000);
    expect(host.audioContextCreatedBeforeWorklet).toBe(true);
  });

  it("rejects a pre-aborted capture before requesting microphone permission", async () => {
    const host = fakeHost();
    const controller = new AbortController();
    controller.abort();

    await expect(createSpeechCaptureSession({ host, signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled", retryable: false });
    expect(host.getUserMediaCalls).toHaveLength(0);
    expect(host.createAudioContextCalls).toBe(0);
  });

  it("stops a late stream and skips AudioContext setup when permission resolves after owner abort", async () => {
    const host = fakeHost();
    host.deferUserMedia = true;
    const controller = new AbortController();
    const capture = createSpeechCaptureSession({ host, signal: controller.signal });

    expect(host.getUserMediaCalls).toHaveLength(1);
    controller.abort();
    host.resolveUserMedia();

    await expect(capture).rejects.toMatchObject({ kind: "cancelled" });
    expect(host.trackStopped).toBe(true);
    expect(host.createAudioContextCalls).toBe(0);
  });

  it("cleans the stream and context when owner abort arrives during setup", async () => {
    const host = fakeHost();
    host.deferWorkletModule = true;
    const controller = new AbortController();
    const capture = createSpeechCaptureSession({ host, signal: controller.signal });
    await host.waitForWorkletModuleAttempt();

    controller.abort();
    host.resolveWorkletModule();

    await expect(capture).rejects.toMatchObject({ kind: "cancelled" });
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(host.workletCreated).toBe(false);
  });

  it("resumes a suspended AudioContext and rejects sample rates below 16 kHz", async () => {
    const suspendedHost = fakeHost();
    suspendedHost.context.stateValue = "suspended";
    await expect(createSpeechCaptureSession({ host: suspendedHost })).resolves.toMatchObject({ actualSampleRateHz: 48_000 });
    expect(suspendedHost.context.resumeCalls).toBe(1);

    const lowRateHost = fakeHost();
    lowRateHost.context.sampleRateValue = 8_000;
    await expect(createSpeechCaptureSession({ host: lowRateHost })).rejects.toMatchObject({ kind: "context_failed" });
    expect(lowRateHost.trackStopped).toBe(true);
    expect(lowRateHost.audioContextClosed).toBe(true);
  });

  it("builds an anti-alias filter graph, keeps the worklet scheduled, and cleans up all resources", async () => {
    const host = fakeHost();
    const session = await createSpeechCaptureSession({ host });

    expect(host.sourceConnections).toEqual(["filter"]);
    expect(host.filterType).toBe("lowpass");
    expect(host.filterFrequency).toBe(7_200);
    expect(host.filterConnections).toEqual(["worklet"]);
    expect(host.workletConnections).toEqual(["gain"]);
    expect(host.gainConnections).toEqual(["destination"]);
    expect(host.gainValue).toBe(0);

    await session.abort();

    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(host.workletPortClosed).toBe(true);
  });

  it("retains bounded batches, sends worklet acknowledgements, emits pause candidates, and rejects late messages after cleanup", async () => {
    const host = fakeHost();
    const candidates: Float32Array[] = [];
    const session = await createSpeechCaptureSession({ host, onPauseCandidate: (candidate) => { candidates.push(candidate.samples); } });

    host.emitWorkletMessage(workletBatch(0, [0.02, 0.02, 0.02, 0.02], 0.02));
    host.emitWorkletMessage(workletBatch(4, new Array(10_400).fill(0), 0.001));

    expect(host.workletAcks).toBe(2);
    expect(candidates).toHaveLength(1);
    expect([...session.endpointWindow()]).toEqual([...session.finalize()]);

    await session.abort();
    host.emitWorkletMessage(workletBatch(10_404, [1, 1, 1, 1], 1));

    expect([...session.finalize()]).toEqual([]);
    expect(host.workletAcks).toBe(2);
  });

  it("emits voiced activity with sample timing so pending endpoint checks can be cancelled on resumed speech", async () => {
    const host = fakeHost();
    const activity: { readonly startSample: number; readonly endSample: number; readonly sampleCount: number }[] = [];
    const session = await createSpeechCaptureSession({ host, onSpeechActivity: (event) => { activity.push(event); } });

    host.emitWorkletMessage(workletBatch(0, [0.02, 0.02], 0.02));
    host.emitWorkletMessage(workletBatch(2, [0, 0], 0.001));
    host.emitWorkletMessage(workletBatch(4, [0.03], 0.03));

    expect(activity).toEqual([
      { startSample: 0, endSample: 2, sampleCount: 2 },
      { startSample: 4, endSample: 5, sampleCount: 1 },
    ]);
    await session.abort();
  });

  it("flushes the worklet before stopAndFinalize snapshots and clears retained chunks exactly once", async () => {
    const host = fakeHost();
    const terminals: SpeechCaptureTerminal[] = [];
    const session = await createSpeechCaptureSession({ host, onTerminal: (terminal) => { terminals.push(terminal); } });
    host.emitWorkletMessage(workletBatch(0, [1, 2], 1));
    host.worklet.onPostMessage = (message) => {
      if (message.kind !== "flush") return;
      host.emitWorkletMessage(workletBatch(2, [3], 1));
      host.emitWorkletMessage({ kind: "flushed", requestId: message.requestId, totalSamples: 3 });
    };

    const first = await session.stopAndFinalize();
    const second = await session.stopAndFinalize();

    expect([...first]).toEqual([1, 2, 3]);
    expect(second).toBe(first);
    expect([...session.finalize()]).toEqual([]);
    expect(host.workletFlushes).toHaveLength(1);
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: "finalized" });
  });

  it("rejects finalization when the worklet never acknowledges flush and drops retained audio", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const terminals: SpeechCaptureTerminal[] = [];
    const session = await createSpeechCaptureSession({ host, onTerminal: (terminal) => { terminals.push(terminal); } });
    host.emitWorkletMessage(workletBatch(0, [1, 2], 1));

    const finalized = session.stopAndFinalize();
    const rejected = expect(finalized).rejects.toMatchObject({ kind: "worklet_failed", retryable: false });
    await vi.advanceTimersByTimeAsync(250);
    await rejected;

    expect([...session.finalize()]).toEqual([]);
    expect(host.workletFlushes).toHaveLength(1);
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: "failed", error: { kind: "worklet_failed", retryable: false } });
    expect([...terminals[0]?.samples ?? []]).toEqual([]);

    host.emitWorkletMessage({ kind: "flushed", requestId: host.workletFlushes[0] ?? "flush-1", totalSamples: 2 });
    await session.abort();
    expect(terminals).toHaveLength(1);
  });

  it("turns worklet overflow into an exactly-once terminal failure and clears gapped audio", async () => {
    const host = fakeHost();
    const terminals: SpeechCaptureTerminal[] = [];
    const session = await createSpeechCaptureSession({ host, onTerminal: (terminal) => { terminals.push(terminal); } });
    host.emitWorkletMessage(workletBatch(0, [1, 2], 1));

    host.emitWorkletMessage({ kind: "overflow", totalSamples: 2 });
    await settleLifecycle();
    host.emitWorkletMessage({ kind: "overflow", totalSamples: 2 });
    host.emitWorkletMessage(workletBatch(2, [3], 1));

    expect(session.failure).toMatchObject({ kind: "overflow", retryable: false });
    expect([...session.finalize()]).toEqual([]);
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: "failed", error: { kind: "overflow" } });
    expect([...terminals[0]?.samples ?? []]).toEqual([]);
  });

  it("treats the capture limit as terminal, returns finalized samples to the owner, and releases resources", async () => {
    const host = fakeHost();
    const terminals: SpeechCaptureTerminal[] = [];
    const session = await createSpeechCaptureSession({ host, onTerminal: (terminal) => { terminals.push(terminal); } });
    host.emitWorkletMessage(workletBatch(0, [1, 2], 1));

    host.emitWorkletMessage({ kind: "limit", totalSamples: 2 });
    await settleLifecycle();

    expect(session.failure).toMatchObject({ kind: "limit_reached" });
    expect([...session.finalize()]).toEqual([]);
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: "failed", error: { kind: "limit_reached" } });
    expect([...terminals[0]?.samples ?? []]).toEqual([1, 2]);
  });

  it("tracks ended as a terminal failure and clears retained audio", async () => {
    const host = fakeHost();
    const terminals: SpeechCaptureTerminal[] = [];
    const session = await createSpeechCaptureSession({ host, onTerminal: (terminal) => { terminals.push(terminal); } });
    host.emitWorkletMessage(workletBatch(0, [1, 2], 1));

    host.endTrack();
    await settleLifecycle();

    expect(session.failure).toMatchObject({ kind: "track_ended" });
    expect([...session.finalize()]).toEqual([]);
    expect(host.trackStopped).toBe(true);
    expect(host.audioContextClosed).toBe(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: "failed", error: { kind: "track_ended" } });
    expect([...terminals[0]?.samples ?? []]).toEqual([]);
  });

  it("shares one in-flight cleanup promise across concurrent aborts", async () => {
    const host = fakeHost();
    host.deferContextClose = true;
    const session = await createSpeechCaptureSession({ host });

    const first = session.abort();
    const second = session.abort();
    expect(host.context.closeCalls).toBe(1);

    host.resolveContextClose();
    await Promise.all([first, second]);
    expect(host.context.closeCalls).toBe(1);
  });

  it("maps unsupported, denied, hardware, worklet, and track-end failures to stable capture errors", async () => {
    await expect(createSpeechCaptureSession({ host: unsupportedHost() })).rejects.toMatchObject({ kind: "unsupported" });
    expect(mapSpeechCaptureFailure(new DOMException("denied", "NotAllowedError"))).toMatchObject({ kind: "permission_denied" });
    expect(mapSpeechCaptureFailure(new DOMException("missing", "NotFoundError"))).toMatchObject({ kind: "device_unavailable" });

    const host = fakeHost();
    host.failWorklet = true;
    await expect(createSpeechCaptureSession({ host })).rejects.toMatchObject({ kind: "worklet_load_failed" });

    const endingHost = fakeHost();
    const session = await createSpeechCaptureSession({ host: endingHost });
    endingHost.endTrack();
    expect(session.failure).toMatchObject({ kind: "track_ended" });
    await session.abort();
  });
});

async function settleLifecycle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function batch(startSample: number, rms: number, sampleCount: number) {
  return { startSample, endSample: startSample + sampleCount, sampleCount, rms, voiced: rms >= 0.012 };
}

function workletBatch(startSample: number, values: number[] | Iterable<number>, rms: number): SpeechCaptureMessage {
  const samples = Float32Array.from(values);
  return { kind: "batch", startSample, endSample: startSample + samples.length, samples, rms, voiced: rms >= 0.012 };
}

class RecordingMediaTrack implements SpeechMediaTrackLike {
  private endedListener: (() => void) | undefined;
  public stopped = false;

  public stop(): void {
    this.stopped = true;
  }

  public addEventListener(_type: "ended", listener: () => void): void {
    this.endedListener = listener;
  }

  public removeEventListener(): void {
    this.endedListener = undefined;
  }

  public end(): void {
    this.endedListener?.();
  }
}

class RecordingMediaStream implements SpeechMediaStreamLike {
  public constructor(private readonly track: RecordingMediaTrack) {}

  public getAudioTracks(): SpeechMediaTrackLike[] {
    return [this.track];
  }
}

class RecordingAudioNode implements SpeechAudioNodeLike {
  public readonly connections: string[] = [];

  public constructor(public readonly kind: string) {}

  public connect(target: unknown): void {
    this.connections.push(nodeKind(target));
  }

  public disconnect(): void {
    this.connections.splice(0);
  }
}

class RecordingBiquadFilter extends RecordingAudioNode implements SpeechBiquadFilterLike {
  public type: BiquadFilterType = "lowpass";
  public readonly frequency = { value: 0 };

  public constructor() {
    super("filter");
  }
}

class RecordingGainNode extends RecordingAudioNode implements SpeechGainNodeLike {
  public readonly gain = { value: 1 };

  public constructor() {
    super("gain");
  }
}

class RecordingWorkletNode extends RecordingAudioNode implements SpeechAudioWorkletNodeLike {
  private listener: ((event: MessageEvent<SpeechCaptureMessage>) => void) | undefined;
  public acks = 0;
  public readonly flushes: string[] = [];
  public closed = false;
  public onPostMessage: ((message: SpeechCaptureControlMessage) => void) | undefined;
  public readonly port = {
    postMessage: (message: SpeechCaptureControlMessage): void => {
      if (message.kind === "ack") this.acks += 1;
      if (message.kind === "flush") this.flushes.push(message.requestId);
      this.onPostMessage?.(message);
    },
    addEventListener: (_type: "message", listener: (event: MessageEvent<SpeechCaptureMessage>) => void): void => { this.listener = listener; },
    removeEventListener: (): void => { this.listener = undefined; },
    start: (): void => undefined,
    close: (): void => { this.closed = true; },
  };

  public constructor() {
    super("worklet");
  }

  public emit(message: SpeechCaptureMessage): void {
    this.listener?.(new MessageEvent<SpeechCaptureMessage>("message", { data: message }));
  }
}

class RecordingAudioContext implements SpeechAudioContextLike {
  public sampleRateValue = 48_000;
  public stateValue: AudioContextState = "running";
  public readonly destination = new RecordingAudioNode("destination");
  public readonly source = new RecordingAudioNode("source");
  public readonly filter = new RecordingBiquadFilter();
  public readonly gain = new RecordingGainNode();
  public closed = false;
  public moduleAdded = false;
  public resumeCalls = 0;
  public closeCalls = 0;
  private readonly workletModuleWaiters: (() => void)[] = [];
  private workletModuleResolve: (() => void) | undefined;
  private contextCloseResolve: (() => void) | undefined;

  public constructor(private readonly owner: RecordingSpeechHost) {}

  public get sampleRate(): number {
    return this.sampleRateValue;
  }

  public get state(): AudioContextState {
    return this.stateValue;
  }

  public readonly audioWorklet = {
    addModule: (): Promise<void> => {
      this.moduleAdded = true;
      this.owner.audioContextCreatedBeforeWorklet = true;
      this.workletModuleWaiters.splice(0).forEach((resolve) => { resolve(); });
      if (this.owner.failWorklet) return Promise.reject(new Error("worklet failed"));
      if (!this.owner.deferWorkletModule) return Promise.resolve();
      return new Promise((resolve) => { this.workletModuleResolve = resolve; });
    },
  };

  public waitForWorkletModuleAttempt(): Promise<void> {
    if (this.moduleAdded) return Promise.resolve();
    return new Promise((resolve) => { this.workletModuleWaiters.push(resolve); });
  }

  public resolveWorkletModule(): void {
    this.workletModuleResolve?.();
  }

  public resolveContextClose(): void {
    this.contextCloseResolve?.();
  }

  public resume(): Promise<void> {
    this.resumeCalls += 1;
    this.stateValue = "running";
    return Promise.resolve();
  }

  public createMediaStreamSource(): SpeechAudioNodeLike {
    return this.source;
  }

  public createBiquadFilter(): SpeechBiquadFilterLike {
    return this.filter;
  }

  public createGain(): SpeechGainNodeLike {
    return this.gain;
  }

  public close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
    if (!this.owner.deferContextClose) return Promise.resolve();
    return new Promise((resolve) => { this.contextCloseResolve = resolve; });
  }
}

class RecordingSpeechHost implements SpeechCaptureBrowserHost {
  public readonly getUserMediaCalls: MediaStreamConstraints[] = [];
  public readonly track = new RecordingMediaTrack();
  public readonly context = new RecordingAudioContext(this);
  public readonly worklet = new RecordingWorkletNode();
  public readonly workletUrl = "worklet.js";
  public audioContextCreatedBeforeWorklet = false;
  public failWorklet = false;
  public deferUserMedia = false;
  public deferWorkletModule = false;
  public deferContextClose = false;
  public createAudioContextCalls = 0;
  public workletCreated = false;
  private userMediaResolve: ((stream: SpeechMediaStreamLike) => void) | undefined;
  public readonly mediaDevices = {
    getUserMedia: (constraints: MediaStreamConstraints): Promise<SpeechMediaStreamLike> => {
      this.getUserMediaCalls.push(constraints);
      if (!this.deferUserMedia) return Promise.resolve(new RecordingMediaStream(this.track));
      return new Promise((resolve) => { this.userMediaResolve = resolve; });
    },
  };

  public createAudioContext(): SpeechAudioContextLike {
    this.createAudioContextCalls += 1;
    return this.context;
  }

  public createAudioWorkletNode(): SpeechAudioWorkletNodeLike {
    this.workletCreated = true;
    return this.worklet;
  }

  public resolveUserMedia(): void {
    this.userMediaResolve?.(new RecordingMediaStream(this.track));
  }

  public waitForWorkletModuleAttempt(): Promise<void> {
    return this.context.waitForWorkletModuleAttempt();
  }

  public resolveWorkletModule(): void {
    this.context.resolveWorkletModule();
  }

  public resolveContextClose(): void {
    this.context.resolveContextClose();
  }

  public get sourceConnections(): string[] {
    return this.context.source.connections;
  }

  public get filterConnections(): string[] {
    return this.context.filter.connections;
  }

  public get workletConnections(): string[] {
    return this.worklet.connections;
  }

  public get gainConnections(): string[] {
    return this.context.gain.connections;
  }

  public get workletAcks(): number {
    return this.worklet.acks;
  }

  public get workletFlushes(): string[] {
    return this.worklet.flushes;
  }

  public get trackStopped(): boolean {
    return this.track.stopped;
  }

  public get audioContextClosed(): boolean {
    return this.context.closed;
  }

  public get workletPortClosed(): boolean {
    return this.worklet.closed;
  }

  public get filterType(): BiquadFilterType {
    return this.context.filter.type;
  }

  public get filterFrequency(): number {
    return this.context.filter.frequency.value;
  }

  public get gainValue(): number {
    return this.context.gain.gain.value;
  }

  public emitWorkletMessage(message: SpeechCaptureMessage): void {
    this.worklet.emit(message);
  }

  public endTrack(): void {
    this.track.end();
  }
}

function fakeHost(): RecordingSpeechHost {
  return new RecordingSpeechHost();
}

function unsupportedHost(): SpeechCaptureBrowserHost {
  const host = fakeHost();
  return {
    createAudioContext: () => host.createAudioContext(),
    createAudioWorkletNode: () => host.createAudioWorkletNode(),
    workletUrl: "worklet.js",
  };
}

function nodeKind(value: unknown): string {
  return value instanceof RecordingAudioNode ? value.kind : "unknown";
}

expect(new SpeechCaptureError("unsupported", "test")).toBeInstanceOf(Error);
