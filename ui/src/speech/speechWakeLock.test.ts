import { describe, expect, it, vi } from "vitest";
import { keepSpeechScreenAwake, type SpeechWakeLockHost, type SpeechWakeLockSentinel } from "./speechWakeLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function sentinel() {
  const lock = Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn(async () => { lock.released = true; lock.dispatchEvent(new Event("release")); }),
  });
  return lock;
}

function fixture() {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const locks: SpeechWakeLockSentinel[] = [];
  const request = vi.fn(async (): Promise<SpeechWakeLockSentinel> => { const lock = sentinel(); locks.push(lock); return lock; });
  const onUnavailable = vi.fn();
  const host: SpeechWakeLockHost = { page, wakeLock: { request }, onUnavailable };
  const visibility = (state: string) => { page.visibilityState = state; page.dispatchEvent(new Event("visibilitychange")); };
  return { host, page, locks, request, onUnavailable, visibility };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("speech screen wake lock", () => {
  it("requests a screen lock and releases it exactly once when capture ends", async () => {
    const { host, request, locks } = fixture();
    const dispose = keepSpeechScreenAwake(host);
    await settle();
    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
    dispose(); dispose();
    await settle();
    expect(locks[0]?.release).toHaveBeenCalledOnce();
  });

  it("releases on hide and reacquires on foreground, but never after disposal", async () => {
    const { host, request, locks, visibility } = fixture();
    const dispose = keepSpeechScreenAwake(host);
    await settle();
    visibility("hidden"); await settle();
    expect(locks[0]?.release).toHaveBeenCalledOnce();
    visibility("visible"); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    dispose();
    visibility("hidden"); visibility("visible"); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(locks[1]?.release).toHaveBeenCalledOnce();
  });

  it("waits for the foreground before requesting a lock", async () => {
    const { host, request, visibility } = fixture();
    visibility("hidden");
    const dispose = keepSpeechScreenAwake(host);
    expect(request).not.toHaveBeenCalled();
    visibility("visible"); await settle();
    expect(request).toHaveBeenCalledOnce();
    dispose();
  });

  it("releases a lock that arrives after capture ends", async () => {
    const { host, request } = fixture();
    const pending = deferred<SpeechWakeLockSentinel>();
    request.mockImplementation(() => pending.promise);
    const dispose = keepSpeechScreenAwake(host);
    dispose();
    const lock = sentinel(); pending.resolve(lock); await settle();
    expect(lock.release).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it("releases a stale pending lock and reacquires after a hide/show race", async () => {
    const { host, request, visibility } = fixture();
    const pending = deferred<SpeechWakeLockSentinel>();
    request.mockImplementationOnce(() => pending.promise);
    const dispose = keepSpeechScreenAwake(host);
    visibility("hidden"); visibility("visible");
    expect(request).toHaveBeenCalledOnce();
    const lock = sentinel(); pending.resolve(lock); await settle();
    expect(lock.release).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("does not retry in a loop when the browser revokes a visible lock", async () => {
    const { host, request, locks, visibility } = fixture();
    const dispose = keepSpeechScreenAwake(host);
    await settle();
    await locks[0]?.release(); await settle();
    expect(request).toHaveBeenCalledOnce();
    visibility("hidden"); visibility("visible"); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("reports unsupported and denied locks without blocking microphone capture", async () => {
    const { host, request, onUnavailable, visibility } = fixture();
    const unsupported = keepSpeechScreenAwake({ ...host, wakeLock: undefined });
    expect(onUnavailable).toHaveBeenCalledOnce(); unsupported();
    onUnavailable.mockClear();
    request.mockRejectedValueOnce(new DOMException("Power saving", "NotAllowedError"));
    const dispose = keepSpeechScreenAwake(host);
    await settle();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "NotAllowedError" }));
    expect(request).toHaveBeenCalledOnce();
    visibility("hidden"); visibility("visible"); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("reports release errors without leaving an unhandled rejection", async () => {
    const { host, locks, onUnavailable } = fixture();
    const dispose = keepSpeechScreenAwake(host); await settle();
    vi.mocked(locks[0]!.release).mockRejectedValueOnce(new Error("Release failed"));
    dispose(); await settle();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "Release failed" }));
  });
});
