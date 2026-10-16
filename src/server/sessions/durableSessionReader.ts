import { DurableOpenPublisher } from "./durableOpenPublisher.js";
import { readTaskActivity } from "./durableTaskActivity.js";
import type { TaskActivity } from "../../shared/durableTaskActivity.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { SessionOpenPageRequest, SessionOpenResult } from "./sessionOpen.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { SessionRef, SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import type { DurableNativeHistory } from "./durableNativeHistory.js";
import { DurableParentReadModel, type DurableBrowserAttachment, type DurableHostState } from "./durableParentReadModel.js";
import type { DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";
import type { MessagePageRequest } from "./messagePaging.js";
import { findSessionImage, type SessionImage } from "./sessionImages.js";

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
  private readonly publishers = new Set<DurableOpenPublisher>();
  private readonly publisherAdmissions = new Map<string, Promise<DurableOpenPublisher>>();
  private readonly attachments = new Set<DurableBrowserAttachment>();
  private readonly opening = new Set<Promise<DurableBrowserAttachment | undefined>>();
  constructor(private readonly options: DurableSessionReaderOptions) {}

  async close(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.publishers].map(publisher => publisher.stop()));
    // Stop admitted publishers before waiting for seeds. New admissions observe stopped and release.
    await Promise.all([...this.attachments].map((attachment) => attachment.stop()));
    await Promise.allSettled(this.opening);
    await Promise.all([...this.publishers].map(publisher => publisher.stop()));
    await Promise.all([...this.attachments].map((attachment) => attachment.stop()));
  }

  async tasks(ref: SessionRef): Promise<TaskActivity> {
    return await this.read(ref, handle => readTaskActivity(handle.harness, handle.conversation.id, context)) ?? { kind: "unsupported" };
  }

  locate(ref: SessionRef): Promise<DurableSessionAddress | undefined> { return this.options.locate(ref); }

  open(ref: SessionRef, page: SessionOpenPageRequest, hub: SessionEventHub, hostStatus?: () => DurableHostState): Promise<SessionOpenResult | undefined> {
    return this.read(ref, async handle => {
      const model = this.options.readModel(handle);
      return model.annotateOpen(await model.open(ref.cwd, page, hub, context, hostStatus));
    });
  }

  async openAddress(ref: SessionRef, address: DurableSessionAddress, page: SessionOpenPageRequest, hub: SessionEventHub,
    hostStatus?: () => DurableHostState): Promise<SessionOpenResult> {
    if (this.stopped) throw new Error("Durable session reader is closed");
    const handle = await this.options.acquire(address);
    try {
      const model = this.options.readModel(handle);
      return model.annotateOpen(await model.open(ref.cwd, page, hub, context, hostStatus));
    }
    finally { await handle.release(context); }
  }

  messages(ref: SessionRef, page?: MessagePageRequest): Promise<DurableBrowserSnapshot["history"] | undefined> {
    return this.read(ref, (handle) => this.options.readModel(handle).history(page, context));
  }

  /** One image a live frame referenced. Undefined when the session has no native locator. */
  image(ref: SessionRef, messageId: string, image: number): Promise<SessionImage | null | undefined> {
    return this.read(ref, async (handle) => findSessionImage(await this.options.readModel(handle).messages(context), messageId, image) ?? null);
  }

  tree(ref: SessionRef): Promise<SessionTreeSnapshot | undefined> {
    return this.read(ref, (handle) => this.options.history(handle).tree(context));
  }

  /** One coalescing replacement publisher. Adoption listeners never call Harness APIs. */
  attachOpen(ref: SessionRef, hub: SessionEventHub, send: (open: SessionOpenResult) => Promise<void>,
    onFailure: (error: Error) => void, hostStatus?: () => DurableHostState): Promise<DurableBrowserAttachment | undefined> {
    if (this.stopped) return Promise.reject(new Error("Durable session reader is closed"));
    const opening = this.locate(ref).then(address => {
      if (this.stopped) throw new Error("Durable session reader is closed");
      return address === undefined ? undefined : this.openCheckpointAttachment(ref, address, hub, send, onFailure, hostStatus);
    });
    this.opening.add(opening);
    void opening.then(() => { this.opening.delete(opening); }, () => { this.opening.delete(opening); });
    return opening;
  }

  private async openCheckpointAttachment(ref: SessionRef, address: DurableSessionAddress, hub: SessionEventHub, send: (open: SessionOpenResult) => Promise<void>,
    onFailure: (error: Error) => void, hostStatus?: () => DurableHostState): Promise<DurableBrowserAttachment> {
    const key = JSON.stringify([address.databasePath, address.journalId, address.sessionId, address.conversationId]);
    let opening = this.publisherAdmissions.get(key);
    if (opening === undefined) {
      opening = this.createPublisher(ref, address, hub, hostStatus, () => { this.publisherAdmissions.delete(key); });
      this.publisherAdmissions.set(key, opening);
      const admitted = opening;
      void opening.catch(() => { if (this.publisherAdmissions.get(key) === admitted) this.publisherAdmissions.delete(key); });
    }
    return (await opening).attach(send, onFailure);
  }

  private async createPublisher(ref: SessionRef, address: DurableSessionAddress, hub: SessionEventHub,
    hostStatus: (() => DurableHostState) | undefined, onStop: () => void): Promise<DurableOpenPublisher> {
    const handle = await this.options.acquire(address);
    try {
      if (this.stopped) throw new Error("Durable session reader is closed");
      const publisher = new DurableOpenPublisher(handle, this.options.readModel(handle), ref.cwd, hub, context, hostStatus ?? (() => ({})), onStop);
      this.publishers.add(publisher);
      void publisher.closed.then(() => { this.publishers.delete(publisher); });
      return publisher;
    } catch (error) { await handle.release(context); throw error; }
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
