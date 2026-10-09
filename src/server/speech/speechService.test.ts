import { describe, expect, it, vi } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { createSpeechService, type SpeechBackend } from "./speechService.js";

function pcm(samples = 16_000): Uint8Array {
  return new Uint8Array(samples * 4);
}

function pcmWith(sample: number): Uint8Array {
  const bytes = new Uint8Array(SPEECH_POLICY.audio.minRequestBytes);
  new DataView(bytes.buffer).setFloat32(0, sample, true);
  return bytes;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("speech service", () => {

  it("validates raw PCM bytes before backend admission", async () => {
    let calls = 0;
    const whisper: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      transcribe: () => {
        calls += 1;
        return Promise.resolve({ text: "ok" });
      },
    };
    const service = createSpeechService({ whisper });

    await expect(service.transcribe(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ kind: "misaligned" });
    await expect(service.transcribe(new Uint8Array(SPEECH_POLICY.audio.minRequestBytes - SPEECH_POLICY.audio.bytesPerSample))).rejects.toMatchObject({ kind: "too_short" });
    await expect(service.transcribe(pcmWith(Number.NaN))).rejects.toMatchObject({ kind: "non_finite" });
    await expect(service.transcribe(pcmWith(2))).rejects.toMatchObject({ kind: "out_of_range" });
    await expect(service.transcribe(new Uint8Array(SPEECH_POLICY.audio.maxTurnBytes + 4))).rejects.toMatchObject({ kind: "too_large" });
    expect(calls).toBe(0);
  });

  it("admits one active and one queued operation and rejects overload before retaining more PCM", async () => {
    const first = deferred<{ text: string }>();
    const second = deferred<{ text: string }>();
    let calls = 0;
    const whisper: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      transcribe: () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    };
    const service = createSpeechService({ whisper });

    const active = service.transcribe(pcm());
    const queued = service.transcribe(pcm());
    await expect(service.transcribe(pcm())).rejects.toMatchObject({ kind: "overloaded" });
    expect(calls).toBe(1);
    first.resolve({ text: "first" });
    await expect(active).resolves.toMatchObject({ text: "first" });
    await vi.waitFor(() => { expect(calls).toBe(2); });
    second.resolve({ text: "second" });
    await expect(queued).resolves.toMatchObject({ text: "second" });
  });

  it("removes queued cancelled work immediately while active cancellation waits for backend settlement", async () => {
    const activeGate = deferred<{ text: string }>();
    const secondGate = deferred<{ text: string }>();
    let calls = 0;
    const whisper: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      transcribe: () => {
        calls += 1;
        return calls === 1 ? activeGate.promise : secondGate.promise;
      },
    };
    const service = createSpeechService({ whisper });
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();

    const active = service.transcribe(pcm(), { signal: activeAbort.signal });
    const queued = service.transcribe(pcm(), { signal: queuedAbort.signal });
    activeAbort.abort();
    queuedAbort.abort();
    await expect(active).rejects.toMatchObject({ kind: "aborted" });
    await expect(queued).rejects.toMatchObject({ kind: "aborted" });

    const replacement = service.transcribe(pcm());
    expect(calls).toBe(1);
    activeGate.resolve({ text: "first" });
    await vi.waitFor(() => { expect(calls).toBe(2); });
    secondGate.resolve({ text: "second" });
    await expect(replacement).resolves.toMatchObject({ text: "second" });
  });

  it("expires queued work against the original queue-inclusive deadline", async () => {
    const activeGate = deferred<{ text: string }>();
    let calls = 0;
    const service = createSpeechService({
      policy: { ...SPEECH_POLICY, timing: { ...SPEECH_POLICY.timing, operationDeadlineMs: 30 } },
      whisper: {
        status: () => "ready",
        start: () => Promise.resolve(),
        close: () => Promise.resolve(),
        transcribe: () => {
          calls += 1;
          return activeGate.promise;
        },
      },
    });

    const active = service.transcribe(pcm());
    const activeExpectation = expect(active).rejects.toMatchObject({ kind: "timeout" });
    const queued = service.transcribe(pcm());
    await expect(queued).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toBe(1);
    const followUp = service.transcribe(pcm());
    expect(calls).toBe(1);
    activeGate.resolve({ text: "done" });
    await activeExpectation;
    await expect(followUp).resolves.toEqual({ text: "done" });
    expect(calls).toBe(2);
  });

  it("passes only the remaining backend budget after queued wait", async () => {
    const activeGate = deferred<{ text: string }>();
    const budgets: number[] = [];
    const service = createSpeechService({
      policy: { ...SPEECH_POLICY, timing: { ...SPEECH_POLICY.timing, operationDeadlineMs: 100 } },
      whisper: {
        status: () => "ready",
        start: () => Promise.resolve(),
        close: () => Promise.resolve(),
        transcribe: (_pcm, options) => {
          budgets.push(options?.timeoutMs ?? 0);
          return budgets.length === 1 ? activeGate.promise : Promise.resolve({ text: "queued" });
        },
      },
    });

    const active = service.transcribe(pcm());
    const queued = service.transcribe(pcm());
    await new Promise((resolve) => setTimeout(resolve, 25));
    activeGate.resolve({ text: "active" });
    await expect(active).resolves.toEqual({ text: "active" });
    await expect(queued).resolves.toEqual({ text: "queued" });
    expect(budgets).toHaveLength(2);
    expect(budgets[1]).toBeLessThan(budgets[0] ?? 0);
  });

  it("closes Whisper and rejects new work", async () => {
    let closed = 0;
    const component = {
      status: () => "ready" as const,
      start: () => Promise.resolve(),
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    };
    const service = createSpeechService({ whisper: component });
    await service.close();

    expect(closed).toBe(1);
    await expect(service.transcribe(pcm())).rejects.toMatchObject({ kind: "closed" });
  });
});
