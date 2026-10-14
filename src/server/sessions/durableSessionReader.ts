import { readTaskActivity } from "./durableTaskActivity.js";
import type { TaskActivity } from "../../shared/durableTaskActivity.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { SessionOpenResult } from "./sessionOpen.js";
import type { SessionStatus } from "../../shared/apiTypes.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { SessionRef, SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import type { DurableNativeHistory } from "./durableNativeHistory.js";
import { DurableParentReadModel, type DurableBrowserAttachment } from "./durableParentReadModel.js";
import type { DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";
import type { MessagePageRequest } from "./messagePaging.js";

export interface DurableSessionReaderOptions {
  locate(ref: SessionRef): Promise<DurableSessionAddress | undefined>;
  /** Acquire a read lease without calling resume(), root(), or importing JSONL. */
  acquire(address: DurableSessionAddress): Promise<DurableSessionHandle>;
  readModel(handle: DurableSessionHandle): DurableParentReadModel;
  history(handle: DurableSessionHandle): DurableNativeHistory;
}

/** Mixed-store admission. Only absence of a locator selects legacy reads; native errors propagate. */
export class DurableSessionReader {
  private stopped = false;
  private readonly attachments = new Set<DurableBrowserAttachment>();
  private readonly opening = new Set<Promise<DurableBrowserAttachment>>();
  constructor(private readonly options: DurableSessionReaderOptions) {}

  async close(): Promise<void> {
    this.stopped = true;
    // Seeds await bounded transport completion. Then stop all leases, including a seed admitted
    // just before shutdown. Rejected openings already release their candidate in openAttachment.
    await Promise.allSettled(this.opening);
    await Promise.all([...this.attachments].map((attachment) => attachment.stop()));
  }

  async tasks(ref: SessionRef): Promise<TaskActivity> {
    return await this.read(ref, handle => readTaskActivity(handle.harness, handle.conversation.id, context)) ?? { kind: "unsupported" };
  }

  open(ref: SessionRef, page: MessagePageRequest, hub: SessionEventHub, hostStatus?: () => Partial<SessionStatus>): Promise<SessionOpenResult | undefined> {
    return this.read(ref, handle => this.options.readModel(handle).open(ref.cwd, page, hub, context, hostStatus));
  }

  messages(ref: SessionRef, page?: MessagePageRequest): Promise<DurableBrowserSnapshot["history"] | undefined> {
    return this.read(ref, (handle) => this.options.readModel(handle).history(page, context));
  }

  tree(ref: SessionRef): Promise<SessionTreeSnapshot | undefined> {
    return this.read(ref, (handle) => this.options.history(handle).tree(context));
  }

  /** One coalescing replacement publisher. Adoption listeners never call Harness APIs. */
  attachOpen(ref: SessionRef, hub: SessionEventHub, send: (open: SessionOpenResult) => Promise<void>,
    onFailure: (error: Error) => void, hostStatus?: () => Partial<SessionStatus>): Promise<DurableBrowserAttachment> {
    if (this.stopped) return Promise.reject(new Error("Durable session reader is closed"));
    const opening = this.openCheckpointAttachment(ref, hub, send, onFailure, hostStatus);
    this.opening.add(opening);
    void opening.then(() => { this.opening.delete(opening); }, () => { this.opening.delete(opening); });
    return opening;
  }

  private async openCheckpointAttachment(ref: SessionRef, hub: SessionEventHub, send: (open: SessionOpenResult) => Promise<void>,
    onFailure: (error: Error) => void, hostStatus?: () => Partial<SessionStatus>): Promise<DurableBrowserAttachment> {
    const address = await this.options.locate(ref);
    if (address === undefined) throw new Error("Session has no native Durable locator");
    const handle = await this.options.acquire(address);
    const unobserve = hub.observeNative(address.sessionId, handle.harness, handle.conversation.id);
    let stopped = false, dirty = true;
    const isStopped = () => stopped;
    const isDirty = () => dirty;
    const isClosed = () => this.stopped;
    let line: Promise<void> | undefined;
    let resolveClosed!: (end: Awaited<DurableBrowserAttachment["closed"]>) => void;
    const closed: DurableBrowserAttachment["closed"] = new Promise(resolve => { resolveClosed = resolve; });
    const reader = this.options.readModel(handle);
    const publish = async () => {
      while (isDirty() && !isStopped()) {
        dirty = false;
        const open = await reader.open(ref.cwd, { limit: 50 }, hub, context, hostStatus);
        if (!isStopped()) await send(open);
      }
    };
    let releasing: Promise<void> | undefined;
    const release = () => { releasing ??= handle.release(context); return releasing; };
    const stopWatch = handle.harness.subscribeCommits(publication => {
      if (stopped || publication.changes.length === 0) return;
      dirty = true;
      queueMicrotask(schedule);
    });
    const finish = async (end: Awaited<DurableBrowserAttachment["closed"]>) => {
      if (stopped) return;
      stopped = true; stopWatch(); unobserve();
      try { await release(); } finally { this.attachments.delete(attachment); resolveClosed(end); }
    };
    function schedule() {
      if (stopped || line !== undefined) return;
      line = publish().catch(async (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (!isStopped()) onFailure(failure);
        await finish({ reason: "listener_error", error: failure });
      }).finally(() => { line = undefined; if (dirty && !stopped) schedule(); });
    }
    const attachment: DurableBrowserAttachment = { closed, stop: async () => { await finish({ reason: "stopped" }); await line; } };
    this.attachments.add(attachment);
    try { line = publish(); await line; line = undefined; }
    catch (error) { await finish({ reason: "listener_error", error: error instanceof Error ? error : new Error(String(error)) }); throw error; }
    if (isClosed()) await attachment.stop();
    else if (isDirty()) schedule();
    return attachment;
  }

  attach(
    ref: SessionRef,
    send: (snapshot: DurableBrowserSnapshot) => Promise<void>,
    onFailure: (error: Error) => void,
  ): Promise<DurableBrowserAttachment> {
    if (this.stopped) return Promise.reject(new Error("Durable session reader is closed"));
    const opening = this.openAttachment(ref, send, onFailure);
    this.opening.add(opening);
    void opening.then(() => { this.opening.delete(opening); }, () => { this.opening.delete(opening); });
    return opening;
  }

  private async openAttachment(ref: SessionRef, send: (snapshot: DurableBrowserSnapshot) => Promise<void>, onFailure: (error: Error) => void): Promise<DurableBrowserAttachment> {
    const address = await this.options.locate(ref);
    if (address === undefined) throw new Error("Session has no native Durable locator");
    const handle = await this.options.acquire(address);
    let attachment: DurableBrowserAttachment;
    try { attachment = await this.options.readModel(handle).attach(send, onFailure, context); }
    catch (error) { await handle.release(context); throw error; }
    let release: Promise<void> | undefined;
    const detach = () => { release ??= handle.release(context); return release; };
    // A failed listener or daemon close must release the lease even without a socket-close callback.
    void attachment.closed.then(() => detach()).catch((error: unknown) => { onFailure(error instanceof Error ? error : new Error(String(error))); });
    const bound = { closed: attachment.closed, stop: async () => { await attachment.stop(); await detach(); } };
    this.attachments.add(bound);
    void attachment.closed.then(() => { this.attachments.delete(bound); });
    if (this.stopped) await bound.stop();
    return bound;
  }

  private async read<T>(ref: SessionRef, use: (handle: DurableSessionHandle) => Promise<T>): Promise<T | undefined> {
    if (this.stopped) throw new Error("Durable session reader is closed");
    const address = await this.options.locate(ref);
    if (address === undefined) return undefined;
    const handle = await this.options.acquire(address);
    try { return await use(handle); }
    finally { await handle.release(context); }
  }
}
