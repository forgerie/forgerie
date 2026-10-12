import { describe, expect, it, vi } from "vitest";
import { ForgerieDictationAdapter, type DictationDependencies } from "./ForgerieDictationAdapter";
import { SpeechCaptureError, type SpeechCaptureOptions, type SpeechCaptureSession } from "./speechCapture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(samples = new Float32Array(1_600)) {
  const capture: SpeechCaptureSession = {
    actualSampleRateHz: 16_000, failure: undefined,
    endpointWindow: () => samples, finalize: () => samples, synchronize: async () => {},
    stopAndFinalize: vi.fn(async () => samples), abort: vi.fn(async () => {}),
  };
  const dependencies: DictationDependencies = {
    ready: vi.fn(async () => {}), capture: vi.fn(async () => capture),
    transcribe: vi.fn(async () => ({ text: "spoken words" })),
  };
  return { adapter: new ForgerieDictationAdapter(dependencies), dependencies, capture };
}
const started = async (adapter: ForgerieDictationAdapter) => {
  await vi.waitFor(() => expect(adapter.getSnapshot().type).toBe("recording"));
};

describe("Forgerie dictation contract", () => {
  it("captures once, flushes on explicit stop, and commits one final result", async () => {
    const { adapter, dependencies, capture } = fixture();
    const session = adapter.listen();
    const speech = vi.fn(); const end = vi.fn(); const start = vi.fn();
    session.onSpeech(speech); session.onSpeechEnd(end); session.onSpeechStart(start);
    await started(adapter);
    expect(start).toHaveBeenCalledOnce();
    expect(dependencies.transcribe).not.toHaveBeenCalled();
    const first = session.stop();
    expect(session.stop()).toBe(first);
    await first;
    expect(capture.stopAndFinalize).toHaveBeenCalledOnce();
    expect(dependencies.transcribe).toHaveBeenCalledOnce();
    expect(speech).toHaveBeenCalledExactlyOnceWith({ transcript: "spoken words", isFinal: true });
    expect(end).toHaveBeenCalledOnce();
    expect(session.status).toEqual({ type: "ended", reason: "stopped" });
    expect(adapter.getSnapshot()).toEqual({ type: "idle" });
    expect(adapter.disableInputDuringDictation).toBe(true);
  });

  it("cancels a pending capture startup and releases a microphone that arrives late", async () => {
    const { adapter, dependencies, capture } = fixture();
    const pending = deferred<SpeechCaptureSession>();
    dependencies.capture = vi.fn(() => pending.promise);
    const session = adapter.listen(); const speech = vi.fn(); session.onSpeech(speech);
    await vi.waitFor(() => expect(dependencies.capture).toHaveBeenCalledOnce());
    session.cancel();
    pending.resolve(capture);
    await vi.waitFor(() => expect(capture.abort).toHaveBeenCalledOnce());
    expect(speech).not.toHaveBeenCalled();
    expect(dependencies.transcribe).not.toHaveBeenCalled();
    expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
  });

  it("stops during startup only after capture is ready", async () => {
    const { adapter, dependencies, capture } = fixture();
    const pending = deferred<SpeechCaptureSession>();
    dependencies.capture = () => pending.promise;
    const session = adapter.listen();
    const stopped = session.stop();
    pending.resolve(capture);
    await stopped;
    expect(dependencies.transcribe).toHaveBeenCalledOnce();
    expect(adapter.getSnapshot().type).toBe("idle");
  });

  it("aborts transcription, ignores a late response, and preserves the next recording", async () => {
    const { adapter, dependencies } = fixture();
    const pending = deferred<{ text: string }>();
    let requestSignal: AbortSignal | undefined;
    dependencies.transcribe = (_pcm, signal) => { requestSignal = signal; return pending.promise; };
    const first = adapter.listen(); const speech = vi.fn(); first.onSpeech(speech);
    await started(adapter);
    const stopped = first.stop();
    await vi.waitFor(() => expect(adapter.getSnapshot().type).toBe("transcribing"));
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    adapter.cancel();
    expect(requestSignal?.aborted).toBe(true);
    const second = adapter.listen(); await started(adapter);
    pending.resolve({ text: "stale words" }); await stopped;
    expect(speech).not.toHaveBeenCalled();
    expect(adapter.getSnapshot().type).toBe("recording");
    second.cancel();
  });

  it("shows backend refusal without opening the microphone", async () => {
    const { adapter, dependencies } = fixture();
    dependencies.ready = async () => { throw new Error("Speech service is unavailable."); };
    const session = adapter.listen(); const end = vi.fn(); session.onSpeechEnd(end);
    await vi.waitFor(() => expect(adapter.getSnapshot()).toEqual({ type: "failed", message: "Speech service is unavailable." }));
    expect(dependencies.capture).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    expect(session.status).toEqual({ type: "ended", reason: "error" });
  });

  it("reports permission denial, does not commit text, and can start again", async () => {
    const { adapter, dependencies, capture } = fixture();
    dependencies.capture = async () => { throw new Error("Microphone permission was denied."); };
    const session = adapter.listen(); const speech = vi.fn(); session.onSpeech(speech);
    await vi.waitFor(() => expect(adapter.getSnapshot().type).toBe("failed"));
    expect(speech).not.toHaveBeenCalled();
    dependencies.capture = async () => capture;
    const next = adapter.listen(); await started(adapter); next.cancel();
    expect(adapter.getSnapshot().type).toBe("idle");
  });

  it("reports a transcription failure and releases capture", async () => {
    const { adapter, dependencies, capture } = fixture();
    dependencies.transcribe = async () => { throw new Error("Speech request budget is exhausted."); };
    const session = adapter.listen(); const speech = vi.fn(); session.onSpeech(speech);
    await started(adapter); await session.stop();
    expect(adapter.getSnapshot()).toEqual({ type: "failed", message: "Speech request budget is exhausted." });
    expect(capture.abort).toHaveBeenCalledOnce();
    expect(speech).not.toHaveBeenCalled();
  });

  it("rejects a too-short recording before consuming backend capacity", async () => {
    const { adapter, dependencies } = fixture(new Float32Array(10));
    const session = adapter.listen(); await started(adapter); await session.stop();
    expect(adapter.getSnapshot().type).toBe("failed");
    expect(dependencies.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes interrupted audio once without asking the stopped capture to finalize again", async () => {
    const { adapter, dependencies, capture } = fixture();
    let options: SpeechCaptureOptions | undefined;
    dependencies.capture = async (value) => { options = value; return capture; };
    const session = adapter.listen();
    const speech = vi.fn(); const end = vi.fn();
    session.onSpeech(speech); session.onSpeechEnd(end);
    await started(adapter);
    const samples = new Float32Array(1_600);
    options?.onTerminal?.({ kind: "failed", samples, error: new SpeechCaptureError("track_ended", "The microphone track ended.") });
    await session.stop();
    expect(dependencies.transcribe).toHaveBeenCalledExactlyOnceWith(samples, expect.any(AbortSignal));
    expect(capture.stopAndFinalize).not.toHaveBeenCalled();
    expect(speech).toHaveBeenCalledExactlyOnceWith({ transcript: "spoken words", isFinal: true });
    expect(end).toHaveBeenCalledOnce();
    expect(adapter.getSnapshot()).toEqual({ type: "failed", message: "Microphone interrupted. Captured speech was added to your draft." });
  });

  it("ignores a late interrupted-audio transcription after cancellation", async () => {
    const { adapter, dependencies, capture } = fixture();
    let options: SpeechCaptureOptions | undefined;
    dependencies.capture = async (value) => { options = value; return capture; };
    const pending = deferred<{ text: string }>();
    dependencies.transcribe = vi.fn(() => pending.promise);
    const session = adapter.listen(); const speech = vi.fn(); session.onSpeech(speech);
    await started(adapter);
    options?.onTerminal?.({ kind: "failed", samples: new Float32Array(1_600), error: new SpeechCaptureError("track_ended", "The microphone track ended.") });
    await vi.waitFor(() => expect(dependencies.transcribe).toHaveBeenCalledOnce());
    session.cancel();
    pending.resolve({ text: "late partial speech" });
    await session.stop();
    expect(speech).not.toHaveBeenCalled();
    expect(adapter.getSnapshot()).toEqual({ type: "idle" });
  });

  it("releases subscribers and handles a capture terminal failure", async () => {
    const { adapter, dependencies, capture } = fixture();
    let options: SpeechCaptureOptions | undefined;
    dependencies.capture = async (value) => { options = value; return capture; };
    const session = adapter.listen(); const end = vi.fn();
    const unsubscribe = session.onSpeechEnd(end); unsubscribe();
    await started(adapter);
    const { SpeechCaptureError } = await import("./speechCapture");
    options?.onTerminal?.({ kind: "failed", samples: new Float32Array(), error: new SpeechCaptureError("track_ended", "The microphone track ended.") });
    expect(session.status).toEqual({ type: "ended", reason: "error" });
    expect(capture.abort).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
  });
});
