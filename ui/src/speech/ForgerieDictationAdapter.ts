import type { DictationAdapter } from "@assistant-ui/react";
import { getSpeechStatus, transcribeSpeech } from "./speechApi";
import { createSpeechCaptureSession, type SpeechCaptureOptions, type SpeechCaptureSession } from "./speechCapture";
import { SPEECH_POLICY } from "./speechPolicy";

export type DictationState =
  | { type: "idle" }
  | { type: "starting" }
  | { type: "recording" }
  | { type: "transcribing" }
  | { type: "failed"; message: string };

export interface DictationDependencies {
  capture(options: SpeechCaptureOptions): Promise<SpeechCaptureSession>;
  transcribe(pcm: Float32Array, signal: AbortSignal): Promise<{ text: string }>;
  ready(signal: AbortSignal): Promise<void>;
}
const browserDependencies: DictationDependencies = {
  capture: createSpeechCaptureSession,
  transcribe: (pcm, signal) => transcribeSpeech(pcm, { signal, timeoutMs: SPEECH_POLICY.timing.operationDeadlineMs }),
  ready: async (signal) => {
    const status = await getSpeechStatus({ signal, timeoutMs: 5_000 });
    if (status.whisper !== "ready") throw new Error(status.whisper === "warming"
      ? "Speech service is warming up. Try again shortly." : "Speech service is unavailable.");
  },
};

/** Owns one capture and one transcription. Cancellation invalidates both before releasing resources. */
export class ForgerieDictationAdapter implements DictationAdapter {
  readonly disableInputDuringDictation = true;
  private state: DictationState = { type: "idle" };
  private readonly listeners = new Set<() => void>();
  private active: DictationAdapter.Session | undefined;
  constructor(private readonly dependencies: DictationDependencies = browserDependencies) {}
  readonly getSnapshot = (): DictationState => this.state;
  readonly subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };
  private publish(state: DictationState) {
    this.state = state;
    for (const callback of this.listeners) callback();
  }
  readonly cancel = () => { this.active?.cancel(); };

  listen(): DictationAdapter.Session {
    this.cancel();
    const controller = new AbortController();
    const start = new Set<() => void>();
    const speech = new Set<(result: DictationAdapter.Result) => void>();
    const end = new Set<(result: DictationAdapter.Result) => void>();
    let capture: SpeechCaptureSession | undefined;
    let stopTask: Promise<void> | undefined;
    let ended = false;
    const current = () => !ended && this.active === session;
    const finish = (reason: "stopped" | "cancelled" | "error", message?: string) => {
      if (!current()) return;
      ended = true;
      controller.abort();
      session.status = { type: "ended", reason };
      this.active = undefined;
      this.publish(message ? { type: "failed", message } : { type: "idle" });
      // The SDK's speech-end event also releases its composer input lock on failure.
      for (const callback of end) callback({ transcript: "", isFinal: true });
    };
    const fail = (error: unknown) => {
      if (!current()) return;
      finish("error", error instanceof Error ? error.message : "Dictation failed. Try again.");
      void capture?.abort();
    };
    const subscribe = <T,>(set: Set<T>, callback: T) => {
      set.add(callback);
      return () => { set.delete(callback); };
    };
    const session: DictationAdapter.Session = {
      status: { type: "starting" },
      stop: () => {
        if (stopTask) return stopTask;
        if (!current()) return Promise.resolve();
        // Stop can happen while permission or the audio graph is still starting.
        stopTask = (async () => {
          await startup;
          if (!current() || !capture) return;
          this.publish({ type: "transcribing" });
          const pcm = await capture.stopAndFinalize();
          if (!current()) return;
          if (pcm.length < SPEECH_POLICY.audio.minRequestSamples) throw new Error("Recording is too short. Speak for at least 0.1 seconds.");
          const { text } = await this.dependencies.transcribe(pcm, controller.signal);
          if (!current()) return;
          for (const callback of speech) callback({ transcript: text, isFinal: true });
          finish("stopped");
        })().catch(fail);
        return stopTask;
      },
      cancel: () => {
        if (!current()) return;
        finish("cancelled");
        void capture?.abort();
      },
      onSpeechStart: (callback) => subscribe(start, callback),
      onSpeech: (callback) => subscribe(speech, callback),
      onSpeechEnd: (callback) => subscribe(end, callback),
    };
    this.active = session;
    this.publish({ type: "starting" });
    const startup = (async () => {
      await this.dependencies.ready(controller.signal);
      if (!current()) return;
      const opened = await this.dependencies.capture({ signal: controller.signal, onTerminal: (terminal) => {
        if (terminal.kind === "failed") fail(terminal.error);
      } });
      if (!current()) { await opened.abort(); return; }
      capture = opened;
      session.status = { type: "running" };
      this.publish({ type: "recording" });
      for (const callback of start) callback();
    })().catch(fail);
    return session;
  }
}
