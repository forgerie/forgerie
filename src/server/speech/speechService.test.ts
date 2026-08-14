import { describe, expect, it, vi } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { createSpeechService, speechServiceUnavailable, type SpeechBackend } from "./speechService.js";

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
  it("reports manual-only whenever Whisper is ready and Smart Turn is not ready", () => {
    const unavailableSmartTurn = createSpeechService({
      smartTurn: speechServiceUnavailable("missing_runtime"),
      whisper: { status: () => "ready", start: () => Promise.resolve(), close: () => Promise.resolve(), transcribe: () => Promise.resolve({ text: "ok" }) },
    });
    const warmingSmartTurn = createSpeechService({
      smartTurn: { status: () => "warming", start: () => Promise.resolve(), close: () => Promise.resolve(), checkTurn: () => Promise.resolve({ complete: true, probability: 1, samples: 1 }) },
      whisper: { status: () => "ready", start: () => Promise.resolve(), close: () => Promise.resolve(), transcribe: () => Promise.resolve({ text: "ok" }) },
    });
    const warmingWhisper = createSpeechService({
      smartTurn: { status: () => "ready", start: () => Promise.resolve(), close: () => Promise.resolve(), checkTurn: () => Promise.resolve({ complete: true, probability: 1, samples: 1 }) },
      whisper: { status: () => "warming", start: () => Promise.resolve(), close: () => Promise.resolve(), transcribe: () => Promise.resolve({ text: "ok" }) },
    });
    const unavailableWhisper = createSpeechService({
      smartTurn: { status: () => "ready", start: () => Promise.resolve(), close: () => Promise.resolve(), checkTurn: () => Promise.resolve({ complete: true, probability: 1, samples: 1 }) },
      whisper: speechServiceUnavailable("missing_runtime"),
    });

    expect(unavailableSmartTurn.status()).toEqual({ smartTurn: "unavailable", whisper: "ready", capability: "manual-only" });
    expect(warmingSmartTurn.status()).toEqual({ smartTurn: "warming", whisper: "ready", capability: "manual-only" });
    expect(warmingWhisper.status()).toEqual({ smartTurn: "ready", whisper: "warming", capability: "warming" });
    expect(unavailableWhisper.status()).toEqual({ smartTurn: "ready", whisper: "unavailable", capability: "unavailable" });
  });

  it("validates raw PCM bytes before backend admission", async () => {
    let calls = 0;
    const smartTurn: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      checkTurn: () => {
        calls += 1;
        return Promise.resolve({ complete: true, probability: 1, samples: 1 });
      },
    };
    const service = createSpeechService({ smartTurn, whisper: speechServiceUnavailable("missing_runtime") });

    await expect(service.checkTurn(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ kind: "misaligned" });
    await expect(service.checkTurn(new Uint8Array(SPEECH_POLICY.audio.minRequestBytes - SPEECH_POLICY.audio.bytesPerSample))).rejects.toMatchObject({ kind: "too_short" });
    await expect(service.checkTurn(pcmWith(Number.NaN))).rejects.toMatchObject({ kind: "non_finite" });
    await expect(service.checkTurn(pcmWith(2))).rejects.toMatchObject({ kind: "out_of_range" });
    await expect(service.checkTurn(new Uint8Array(SPEECH_POLICY.audio.endpointWindowBytes + 4))).rejects.toMatchObject({ kind: "too_large" });
    expect(calls).toBe(0);
  });

  it("admits one active and one queued operation and rejects overload before retaining more PCM", async () => {
    const first = deferred<{ complete: boolean; probability: number; samples: number }>();
    const second = deferred<{ complete: boolean; probability: number; samples: number }>();
    let calls = 0;
    const smartTurn: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      checkTurn: () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    };
    const service = createSpeechService({ smartTurn, whisper: speechServiceUnavailable("missing_runtime") });

    const active = service.checkTurn(pcm());
    const queued = service.checkTurn(pcm());
    await expect(service.checkTurn(pcm())).rejects.toMatchObject({ kind: "overloaded" });
    expect(calls).toBe(1);
    first.resolve({ complete: false, probability: 0.2, samples: 16_000 });
    await expect(active).resolves.toMatchObject({ complete: false });
    await vi.waitFor(() => { expect(calls).toBe(2); });
    second.resolve({ complete: true, probability: 0.9, samples: 16_000 });
    await expect(queued).resolves.toMatchObject({ complete: true });
  });

  it("removes queued cancelled work immediately while active cancellation waits for backend settlement", async () => {
    const activeGate = deferred<{ complete: boolean; probability: number; samples: number }>();
    const secondGate = deferred<{ complete: boolean; probability: number; samples: number }>();
    let calls = 0;
    const smartTurn: SpeechBackend = {
      status: () => "ready",
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      checkTurn: () => {
        calls += 1;
        return calls === 1 ? activeGate.promise : secondGate.promise;
      },
    };
    const service = createSpeechService({ smartTurn, whisper: speechServiceUnavailable("missing_runtime") });
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();

    const active = service.checkTurn(pcm(), { signal: activeAbort.signal });
    const queued = service.checkTurn(pcm(), { signal: queuedAbort.signal });
    activeAbort.abort();
    queuedAbort.abort();
    await expect(active).rejects.toMatchObject({ kind: "aborted" });
    await expect(queued).rejects.toMatchObject({ kind: "aborted" });

    const replacement = service.checkTurn(pcm());
    expect(calls).toBe(1);
    activeGate.resolve({ complete: false, probability: 0.1, samples: 16_000 });
    await vi.waitFor(() => { expect(calls).toBe(2); });
    secondGate.resolve({ complete: true, probability: 0.8, samples: 16_000 });
    await expect(replacement).resolves.toMatchObject({ complete: true });
  });

  it("expires queued work against the original queue-inclusive deadline", async () => {
    const activeGate = deferred<{ text: string }>();
    let calls = 0;
    const service = createSpeechService({
      policy: { ...SPEECH_POLICY, timing: { ...SPEECH_POLICY.timing, operationDeadlineMs: 30 } },
      smartTurn: speechServiceUnavailable("missing_runtime"),
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
      smartTurn: speechServiceUnavailable("missing_runtime"),
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

  it("closes both components and rejects new work", async () => {
    let closed = 0;
    const component = {
      status: () => "ready" as const,
      start: () => Promise.resolve(),
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    };
    const service = createSpeechService({ smartTurn: component, whisper: component });
    await service.close();

    expect(closed).toBe(2);
    await expect(service.checkTurn(pcm())).rejects.toMatchObject({ kind: "closed" });
  });
});
