export interface SpeechWakeLockSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

export interface SpeechWakeLockHost {
  readonly page: {
    readonly visibilityState: string;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  readonly wakeLock?: { request(type: "screen"): Promise<SpeechWakeLockSentinel> };
  onUnavailable(error: unknown): void;
}

/** Capture owns the returned disposer. A denied lock must never deny microphone access. */
export function keepSpeechScreenAwake(host: SpeechWakeLockHost): () => void {
  const api = host.wakeLock;
  if (api === undefined) {
    host.onUnavailable(new Error("This browser does not support screen wake locks."));
    return () => {};
  }
  let active = true;
  let pending = false;
  let generation = 0;
  let held: SpeechWakeLockSentinel | undefined;
  const visible = () => host.page.visibilityState === "visible";
  const release = (lock: SpeechWakeLockSentinel) => {
    lock.removeEventListener("release", onRelease);
    if (!lock.released) void lock.release().catch((error: unknown) => { host.onUnavailable(error); });
  };
  const releaseHeld = () => {
    const lock = held;
    held = undefined;
    if (lock !== undefined) release(lock);
  };
  const onRelease = () => {
    // Power-saving policy can revoke even a visible lock. Do not fight it in a retry loop.
    held?.removeEventListener("release", onRelease);
    held = undefined;
  };
  const acquire = async () => {
    if (!active || !visible() || pending || held !== undefined) return;
    pending = true;
    const requestedGeneration = generation;
    try {
      const lock = await api.request("screen");
      if (!active || !visible() || requestedGeneration !== generation) release(lock);
      else if (!lock.released) {
        held = lock;
        lock.addEventListener("release", onRelease);
      }
    } catch (error) {
      if (active) host.onUnavailable(error);
    } finally {
      pending = false;
      // A pending request can span hide/show. Its stale result must not own the new lock.
      if (active && visible() && requestedGeneration !== generation) void acquire();
    }
  };
  const onVisibility = () => {
    if (!visible()) {
      generation += 1;
      releaseHeld();
    } else void acquire();
  };
  host.page.addEventListener("visibilitychange", onVisibility);
  void acquire();
  return () => {
    if (!active) return;
    active = false;
    generation += 1;
    host.page.removeEventListener("visibilitychange", onVisibility);
    releaseHeld();
  };
}
