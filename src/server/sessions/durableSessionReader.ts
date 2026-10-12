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

  messages(ref: SessionRef, page?: MessagePageRequest): Promise<DurableBrowserSnapshot["history"] | undefined> {
    return this.read(ref, (handle) => this.options.readModel(handle).history(page, context));
  }

  tree(ref: SessionRef): Promise<SessionTreeSnapshot | undefined> {
    return this.read(ref, (handle) => this.options.history(handle).tree(context));
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
