export const SESSION_SEEN_INPUT_MS = 2 * 60 * 1000;
export const SESSION_SEEN_INTERVAL_MS = 30_000;

export interface PresenceEnvironment {
  now(): number;
  lastInputAt?(): number | undefined;
  visible(): boolean;
  listen(type: string, listener: () => void): () => void;
  repeat(callback: () => void, delay: number): () => void;
}
export const browserPresence: PresenceEnvironment = {
  now: Date.now,
  visible: () => globalThis.document?.visibilityState !== "hidden",
  listen: (type, listener) => {
    globalThis.document?.addEventListener(type, listener, { passive: true, capture: true });
    return () => globalThis.document?.removeEventListener(type, listener, { capture: true });
  },
  repeat: (callback, delay) => { const timer = setInterval(callback, delay); return () => clearInterval(timer); },
};

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"];

/** The registry starts this before the first picker click creates a session store. */
export function createBrowserPresenceEnvironment() {
  let lastInput: number | undefined;
  const cleanups = INPUT_EVENTS.map(type => browserPresence.listen(type, () => { lastInput = browserPresence.now(); }));
  return { ...browserPresence, lastInputAt: () => lastInput, dispose: () => { for (const cleanup of cleanups) cleanup(); } };
}

/** Selection and page visibility are arrival edges. Refreshes only change readiness. */
export function createSessionPresence(options: {
  environment: PresenceEnvironment;
  arrive(active: boolean): Promise<void>;
  seen(keepalive: boolean): Promise<void>;
  failed(error: unknown): void;
}) {
  const env = options.environment;
  let selected = false, ready = false, disposed = false, onScreen = false, pendingArrival = false;
  let lastInput: number | undefined;
  let wasSeen = false;
  let arrival: Promise<void> | undefined;
  const recent = () => {
    const input = env.lastInputAt?.() ?? lastInput;
    return input !== undefined && env.now() - input <= SESSION_SEEN_INPUT_MS;
  };
  const send = (keepalive: boolean) => { void options.seen(keepalive).catch(options.failed); };
  const heartbeat = (cadence = false) => {
    const active = onScreen && ready && recent();
    // The arrival request must reach the daemon before any heartbeat from this
    // activation. Otherwise it would erase the very absence it needs to measure.
    if (arrival !== undefined || pendingArrival) return;
    if (active && (!wasSeen || cadence)) send(false);
    wasSeen = active;
  };
  const depart = () => {
    if (ready && recent()) {
      if (arrival === undefined) send(true);
      else void arrival.then(() => { send(true); });
    }
    wasSeen = false;
  };
  const reconcile = () => {
    const next = selected && env.visible();
    if (onScreen && !next) depart();
    if (!onScreen && next) pendingArrival = true;
    onScreen = next;
    if (!next) pendingArrival = false;
    if (next && ready && pendingArrival && arrival === undefined) {
      pendingArrival = false;
      const active = recent();
      const work = Promise.resolve().then(() => options.arrive(active)).catch(options.failed);
      arrival = work;
      void work.finally(() => {
        if (arrival !== work) return;
        arrival = undefined;
        wasSeen = active && onScreen && ready && recent();
        if (!disposed) reconcile();
      });
    }
    heartbeat();
  };
  const cleanups = [env.listen("visibilitychange", reconcile), env.repeat(() => heartbeat(true), SESSION_SEEN_INTERVAL_MS),
    ...INPUT_EVENTS.map(type => env.listen(type, () => {
      lastInput = env.now(); heartbeat();
    }))];
  return {
    setSelected(next: boolean) { selected = next; reconcile(); },
    setReady(next: boolean) { ready = next; reconcile(); },
    dispose() {
      if (disposed) return;
      if (onScreen) depart();
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    },
  };
}

export function composerHasFocusedText(): boolean {
  const input = globalThis.document?.activeElement?.closest<HTMLElement>("[data-composer-input]");
  if (!input) return false;
  return (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : input.textContent ?? "").trim() !== "";
}
