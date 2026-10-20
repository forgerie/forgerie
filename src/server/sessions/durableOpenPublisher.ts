import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import type { Context } from "@earendil-works/chord";
import type { StackLatencyContext } from "../../shared/stackLatency.js";
import type { WatchEnd } from "@earendil-works/pi-durable";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import type { DurableParentReadModel, DurableBrowserAttachment, DurableHostState } from "./durableParentReadModel.js";
import type { SessionOpenPageRequest, SessionOpenResult } from "./sessionOpen.js";
import { nativeOpenChanged } from "./durableLiveHistory.js";

interface Subscriber {
  stopped: boolean;
  pending: SessionOpenResult | undefined;
  line: Promise<void> | undefined;
  send: (cut: SessionOpenResult) => Promise<void>;
  finish(end: WatchEnd): void;
}

/** One atomic acquisition and history cache per session, with one bounded latest-value slot per transport. */
export class DurableOpenPublisher {
  private stopped = false;
  private dirty = false;
  private latest: SessionOpenResult | undefined;
  private line: Promise<void> | undefined;
  private scheduled: NodeJS.Immediate | undefined;
  private stopping: Promise<void> | undefined;
  private readonly subscribers = new Set<Subscriber>();
  private readonly stopHistory: () => void;
  private readonly stopCommits: () => void;
  private readonly stopHost: () => void;
  private readonly stopLabels: () => void;
  private readonly unobserve: () => void;
  private hostFingerprint: string;
  private resolveClosed!: () => void;
  readonly closed = new Promise<void>(resolve => { this.resolveClosed = resolve; });

  constructor(private readonly handle: DurableSessionHandle, private readonly model: DurableParentReadModel,
    private readonly cwd: string, private readonly hub: SessionEventHub, private readonly context: Context,
    private readonly hostState: () => DurableHostState, private readonly onStop: () => void) {
    this.hostFingerprint = JSON.stringify(hostState());
    this.stopHistory = model.observeHistory();
    this.unobserve = hub.observeNative(handle.address.sessionId, handle.harness, handle.conversation.id);
    this.stopCommits = handle.harness.subscribeCommits(publication => {
      if (nativeOpenChanged(publication, handle.address)) this.changed();
    });
    this.stopHost = hub.observeHostState(handle.address.sessionId, () => {
      const fingerprint = JSON.stringify(hostState());
      if (fingerprint === this.hostFingerprint) return;
      this.hostFingerprint = fingerprint;
      this.changed();
    });
    this.stopLabels = decisionAnnotations(handle.harness).subscribe((scope, key) => {
      if (this.stopped || scope !== String(handle.conversation.id) || !key.startsWith("tool:")) return;
      this.hub.noteDecisionHintChange(handle.address.sessionId);
      this.changed();
    });
  }

  /** Borrow only the derived history after a fresh reader lease admitted this exact owner.
   * Acquire a new cut, not the last socket frame: host state, cursor and annotations stay fresh.
   */
  readOpen(handle: DurableSessionHandle, cwd: string, request: SessionOpenPageRequest, hub: SessionEventHub,
    hostStatus?: () => DurableHostState, trace?: StackLatencyContext): Promise<SessionOpenResult> | undefined {
    if (this.stopped || this.hub !== hub || this.handle.harness !== handle.harness
      || this.handle.address.sessionId !== handle.address.sessionId || this.handle.conversation.id !== handle.conversation.id) return undefined;
    return this.model.open(cwd, request, hub, this.context, hostStatus, trace).then(cut => this.model.annotateOpen(cut));
  }

  async attach(send: Subscriber["send"], onFailure: (error: Error) => void): Promise<DurableBrowserAttachment> {
    if (this.stopped) throw new Error("Native publisher is closed; retry admission");
    let resolveSeed!: () => void, rejectSeed!: (error: Error) => void;
    const seeded = new Promise<void>((resolve, reject) => { resolveSeed = resolve; rejectSeed = reject; });
    let resolveClosed!: (end: WatchEnd) => void;
    const closed = new Promise<WatchEnd>(resolve => { resolveClosed = resolve; });
    const subscriber: Subscriber = { stopped: false, pending: undefined, line: undefined, send,
      finish: end => {
        if (subscriber.stopped) return;
        subscriber.stopped = true; subscriber.pending = undefined;
        this.subscribers.delete(subscriber);
        if (end.reason === "listener_error") {
          let failure = end.error;
          try { onFailure(failure); } catch (error) { failure = asError(error); }
          rejectSeed(failure);
        } else resolveSeed();
        resolveClosed(end);
        if (this.subscribers.size === 0 && !this.stopped) void this.stop();
      } };
    // Resolve the acquisition promise after the first send only, never after the replacement pump drains.
    const originalSend = subscriber.send;
    subscriber.send = async cut => { await originalSend(cut); resolveSeed(); };
    this.subscribers.add(subscriber);
    if (this.latest !== undefined) this.deliver(subscriber, this.latest);
    else this.acquireCut();
    await seeded;
    return { closed, stop: async () => { subscriber.finish({ reason: "stopped" }); await subscriber.line; if (this.subscribers.size === 0) await this.stop(); } };
  }

  private deliver(subscriber: Subscriber, cut: SessionOpenResult): void {
    if (subscriber.stopped) return;
    subscriber.pending = cut;
    if (subscriber.line !== undefined) return;
    const pump = async () => {
      while (!subscriber.stopped && subscriber.pending !== undefined) {
        const next = subscriber.pending; subscriber.pending = undefined;
        const delivered = this.model.annotateOpen(next);
        freezeCut(delivered);
        await subscriber.send(delivered);
      }
    };
    subscriber.line = pump().catch((error: unknown) => { subscriber.finish({ reason: "listener_error", error: asError(error) }); })
      .finally(() => {
        subscriber.line = undefined;
        if (!subscriber.stopped && subscriber.pending !== undefined) this.deliver(subscriber, subscriber.pending);
      });
  }

  private changed(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.line !== undefined || this.scheduled !== undefined) return;
    // A continuously dirty source must still let timers, detach and shutdown run.
    this.scheduled = setImmediate(() => { this.scheduled = undefined; this.acquireCut(); });
  }

  private acquireCut(): void {
    if (this.stopped || this.line !== undefined) return;
    this.dirty = false;
    this.line = this.model.open(this.cwd, { limit: 50 }, this.hub, this.context, this.hostState).then(cut => {
      if (this.stopped || this.latest !== undefined && cut.seq <= this.latest.seq) return;
      // Required data stays immutable and shared. Optional metadata is projected only at delivery.
      freezeCut(cut);
      this.latest = cut;
      for (const subscriber of this.subscribers) this.deliver(subscriber, cut);
    }).catch((error: unknown) => {
      for (const subscriber of [...this.subscribers]) subscriber.finish({ reason: "listener_error", error: asError(error) });
      void this.stop();
    }).finally(() => { this.line = undefined; if (this.dirty && !this.stopped) this.changed(); });
  }

  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    this.stopped = true;
    this.onStop();
    if (this.scheduled !== undefined) clearImmediate(this.scheduled);
    this.stopLabels();
    this.stopCommits(); this.stopHost(); this.unobserve();
    const subscribers = [...this.subscribers];
    for (const subscriber of subscribers) subscriber.finish({ reason: "stopped" });
    this.stopping = (async () => {
      try {
        await this.line;
        await Promise.all(subscribers.flatMap(subscriber => subscriber.line === undefined ? [] : [subscriber.line]));
        this.stopHistory();
        await this.handle.release(this.context);
      } finally { this.resolveClosed(); }
    })();
    return this.stopping;
  }
}
function freezeCut(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeCut(child);
  Object.freeze(value);
}
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
