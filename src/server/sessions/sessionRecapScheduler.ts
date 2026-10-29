import { RECAP_DELAY_MS, type RecapResult, type RecapTrigger } from "../../shared/sessionRecap.js";
import type { SessionUnreadSummary } from "../../shared/apiTypes.js";

export interface RecapGuards {
  enabled: boolean; unread: boolean; idle: boolean; writable: boolean; child: boolean;
  completedTurns: number; newTurns: number; hasRecap: boolean; covered: boolean; hasExchange: boolean;
}
export function canWriteRecap(guards: RecapGuards, trigger: RecapTrigger): boolean {
  if (!guards.idle || !guards.writable || guards.child || !guards.hasExchange) return false;
  if (trigger === "manual") return true;
  return guards.enabled && guards.unread && guards.completedTurns >= 3
    && (!guards.hasRecap || guards.newTurns >= 2) && !guards.covered;
}
export interface RecapIdentity { id: string; cwd: string }
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const keyOf = (ref: RecapIdentity) => JSON.stringify([ref.id, ref.cwd]);

/** Daemon-owned timers. The unread catalog is the only persisted scheduling authority. */
export class SessionRecapScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly flights = new Map<string, { controller: AbortController; promise: Promise<RecapResult> }>();
  private automaticRunning = 0;
  private stopped = false;
  constructor(private readonly generate: (ref: RecapIdentity, trigger: RecapTrigger, signal: AbortSignal) => Promise<RecapResult>,
    private readonly now: () => number = Date.now) {}

  rearm(summaries: readonly SessionUnreadSummary[]): void {
    summaries.forEach((summary, index) => { this.schedule(summary, Math.max(0, Date.parse(summary.completedAt) + RECAP_DELAY_MS - this.now()) + index * 1000); });
  }
  schedule(summary: SessionUnreadSummary, delay = Math.max(0, Date.parse(summary.completedAt) + RECAP_DELAY_MS - this.now()), retry = false): void {
    if (this.stopped) return;
    const ref = { id: summary.sessionId, cwd: summary.cwd }, key = keyOf(ref);
    this.cancel(ref);
    const timer = setTimeout(() => {
      // A wall-clock correction can put a persisted completion beyond Node's timer range.
      if (delay > MAX_TIMER_DELAY_MS) { this.schedule(summary, delay - MAX_TIMER_DELAY_MS, retry); return; }
      if (this.automaticRunning >= 2) { this.schedule(summary, 1000, retry); return; }
      this.automaticRunning++;
      void this.request(ref, "automatic").then(result => {
        if (this.timers.get(key) !== timer) return;
        this.timers.delete(key);
        if (result.kind === "failed" && !retry && !this.stopped) this.schedule(summary, 30_000, true);
      }).finally(() => { this.automaticRunning--; });
    }, Math.min(delay, MAX_TIMER_DELAY_MS));
    timer.unref();
    this.timers.set(key, timer);
  }
  /** Reading cancels timers. A new prompt also invalidates any in-flight request. */
  cancel(ref: RecapIdentity, abort = false): void {
    const key = keyOf(ref);
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    if (abort) this.flights.get(key)?.controller.abort();
  }
  /** Closing a runtime ends its recap work in every cwd: a timer must not reopen what the user stopped. */
  cancelSession(id: string): void {
    const prefix = `${JSON.stringify([id]).slice(0, -1)},`;
    for (const [key, timer] of this.timers) if (key.startsWith(prefix)) { clearTimeout(timer); this.timers.delete(key); }
    for (const [key, flight] of this.flights) if (key.startsWith(prefix)) flight.controller.abort();
  }
  request(ref: RecapIdentity, trigger: RecapTrigger): Promise<RecapResult> {
    if (this.stopped) return Promise.resolve({ kind: "skipped" });
    const key = keyOf(ref), existing = this.flights.get(key);
    if (existing !== undefined) return existing.promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.generate(ref, trigger, controller.signal))
      .then((result): RecapResult => controller.signal.aborted ? { kind: "skipped" } : result)
      .catch((): RecapResult => controller.signal.aborted ? { kind: "skipped" } : { kind: "failed", message: "Could not write a recap. Try /recap again." })
      .finally(() => { if (this.flights.get(key)?.promise === promise) this.flights.delete(key); });
    this.flights.set(key, { controller, promise });
    return promise;
  }
  dispose(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const flight of this.flights.values()) flight.controller.abort();
  }
}
