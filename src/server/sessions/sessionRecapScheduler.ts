import { randomUUID } from "node:crypto";
import { RECAP_AWAY_MS, RECAP_UNSEEN_TURNS, RECAP_LONG_REPLY_CHARS, type RecapResult, type RecapTrigger, type SessionSeenState } from "../../shared/sessionRecap.js";

export interface RecapGuards {
  enabled: boolean; idle: boolean; writable: boolean; child: boolean;
  completedTurns: number; unseenTurns: number; longestUnseenReply: number;
  lastSeenAt: number | undefined; now: number; covered: boolean; hasExchange: boolean;
}
export function canWriteRecap(guards: RecapGuards, trigger: RecapTrigger): boolean {
  if (!guards.idle || !guards.writable || guards.child || !guards.hasExchange) return false;
  if (trigger === "manual") return true;
  // "automatic" is a read-only legacy trigger.
  return trigger === "open" && guards.enabled && guards.completedTurns >= 3 && !guards.covered
    && (guards.lastSeenAt === undefined || guards.now - guards.lastSeenAt >= RECAP_AWAY_MS)
    && (guards.unseenTurns >= RECAP_UNSEEN_TURNS || guards.longestUnseenReply >= RECAP_LONG_REPLY_CHARS);
}
export interface RecapArrival { seen: SessionSeenState | undefined; at: number }
export interface RecapIdentity { id: string; cwd: string }
const ARRIVAL_TTL_MS = 2 * 60_000;
const MAX_ARRIVALS = 1000;
const keyOf = (ref: RecapIdentity) => JSON.stringify([ref.id, ref.cwd]);

/** Daemon-owned in-flight deduplication and cancellation. Recaps run only on request. */
export class SessionRecapScheduler {
  private readonly flights = new Map<string, { controller: AbortController; promise: Promise<RecapResult> }>();
  private stopped = false;
  private readonly arrivals = new Map<string, { key: string; snapshot: RecapArrival }>();
  constructor(private readonly generate: (ref: RecapIdentity, trigger: RecapTrigger, signal: AbortSignal, arrival?: RecapArrival) => Promise<RecapResult>) {}

  /** Short-lived, identity-bound, one-use snapshots make heartbeat/request ordering irrelevant. */
  arrive(ref: RecapIdentity, snapshot: RecapArrival): string {
    for (const [id, arrival] of this.arrivals) if (snapshot.at - arrival.snapshot.at > ARRIVAL_TTL_MS) this.arrivals.delete(id);
    if (this.arrivals.size >= MAX_ARRIVALS) {
      const oldest = this.arrivals.keys().next().value;
      if (oldest !== undefined) this.arrivals.delete(oldest);
    }
    const id = randomUUID();
    this.arrivals.set(id, { key: keyOf(ref), snapshot });
    return id;
  }
  takeArrival(ref: RecapIdentity, id: string | undefined, now: number): RecapArrival | undefined {
    if (id === undefined) return undefined;
    const arrival = this.arrivals.get(id);
    if (arrival?.key !== keyOf(ref)) return undefined;
    this.arrivals.delete(id);
    return now - arrival.snapshot.at <= ARRIVAL_TTL_MS ? arrival.snapshot : undefined;
  }
  cancel(ref: RecapIdentity, abort = false): void {
    if (abort) this.flights.get(keyOf(ref))?.controller.abort();
  }
  cancelSession(id: string): void {
    const prefix = `${JSON.stringify([id]).slice(0, -1)},`;
    for (const [key, flight] of this.flights) if (key.startsWith(prefix)) flight.controller.abort();
    for (const [id, arrival] of this.arrivals) if (arrival.key.startsWith(prefix)) this.arrivals.delete(id);
  }
  request(ref: RecapIdentity, trigger: RecapTrigger, arrival?: RecapArrival): Promise<RecapResult> {
    if (this.stopped) return Promise.resolve({ kind: "skipped" });
    const key = keyOf(ref), existing = this.flights.get(key);
    if (existing !== undefined) return existing.promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.generate(ref, trigger, controller.signal, arrival))
      .then((result): RecapResult => controller.signal.aborted ? { kind: "skipped" } : result)
      .catch((): RecapResult => controller.signal.aborted ? { kind: "skipped" } : { kind: "failed", message: "Could not write a recap. Try /recap again." })
      .finally(() => { if (this.flights.get(key)?.promise === promise) this.flights.delete(key); });
    this.flights.set(key, { controller, promise });
    return promise;
  }
  dispose(): void {
    this.stopped = true;
    this.arrivals.clear();
    for (const flight of this.flights.values()) flight.controller.abort();
  }
}
