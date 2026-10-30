import { isEphemeralSessionPath } from "./ephemeralSessions.js";
import { writeFile } from "node:fs/promises";
import type { Cursor } from "@earendil-works/pi-durable";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import type { DurableNativeHistory } from "./durableNativeHistory.js";
import { SessionManager, type SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { PiAgentSession, PiSessionRuntime } from "./piSessionService.js";
import { DurableAgentSession } from "./durableAgentSession.js";

export interface DurableRuntimeOptions {
  handle?: DurableSessionHandle;
  /** Cohort cutover gate. Enable after conversation-specific SDK dispatch and cache binding are wired. */
  nativeForks?: true;
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
  sessionStartEvent?: SessionStartEvent;
}
export interface DurableRuntimeResult {
  session: DurableAgentSession;
  services: NonNullable<PiSessionRuntime["services"]>;
  diagnostics?: PiSessionRuntime["diagnostics"];
}
export type DurableRuntimeFactory = (options: DurableRuntimeOptions) => Promise<DurableRuntimeResult>;

/** Session replacement closes the outgoing journal. It never turns a daemon close into an explicit Stop. */
export class DurableSessionRuntime implements PiSessionRuntime {
  private rebind: ((session: PiAgentSession) => Promise<void>) | undefined;
  private result: DurableRuntimeResult;
  private closed = false;

  private constructor(private readonly create: DurableRuntimeFactory, private readonly options: DurableRuntimeOptions, result: DurableRuntimeResult) {
    this.result = result;
  }
  static async open(create: DurableRuntimeFactory, options: DurableRuntimeOptions): Promise<DurableSessionRuntime> {
    return new DurableSessionRuntime(create, options, await create(options));
  }
  get cwd(): string { return this.session.sessionManager.getCwd(); }
  get session(): DurableAgentSession { return this.result.session; }
  get services(): DurableRuntimeResult["services"] { return this.result.services; }
  get diagnostics(): NonNullable<PiSessionRuntime["diagnostics"]> { return this.result.diagnostics ?? []; }
  setRebindSession(rebind?: (session: PiAgentSession) => Promise<void>): void { this.rebind = rebind; }

  async fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }> {
    const position = options?.position ?? "before";
    const before = await this.session.extensionRunner.emit({ type: "session_before_fork", entryId, position });
    if (before?.cancel === true) return { cancelled: true };
    if (isEphemeralSessionPath(this.session.sessionFile)) return this.forkEphemeral(entryId, position);
    if (this.options.nativeForks === true || this.options.handle !== undefined) return this.forkNative(entryId, position);
    const manager = this.session.sessionManager;
    const entry = manager.getEntry(entryId);
    if (entry === undefined) throw new Error("Invalid entry ID for forking");
    if (position === "before" && (entry.type !== "message" || entry.message.role !== "user")) throw new Error("Only a user message can be forked from before its entry");
    const leaf = position === "at" ? entry.id : entry.parentId;
    const selectedText = position === "before" && entry.type === "message" && entry.message.role === "user"
      ? typeof entry.message.content === "string" ? entry.message.content : entry.message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") : undefined;
    const sessionFile = manager.getSessionFile();
    let replacement: SessionManager;
    if (leaf === null) {
      replacement = SessionManager.create(this.cwd, manager.getSessionDir(), sessionFile === undefined ? undefined : { parentSession: sessionFile });
    } else if (sessionFile === undefined) {
      manager.createBranchedSession(leaf);
      replacement = manager;
    } else {
      replacement = SessionManager.open(sessionFile, dirname(sessionFile));
      const forked = replacement.createBranchedSession(leaf);
      if (forked === undefined) throw new Error("Failed to persist the forked session");
    }
    // Construct first: a provider/resource failure must not close the outgoing session.
    const candidate = await this.create({ ...this.options, cwd: replacement.getCwd(), sessionManager: replacement,
      sessionStartEvent: { type: "session_start", reason: "fork", ...(sessionFile === undefined ? {} : { previousSessionFile: sessionFile }) } });
    try { await this.closeResult(this.result); }
    catch (error) { await this.closeResult(candidate); throw error; }
    this.result = candidate;
    await this.rebind?.(this.session);
    return { cancelled: false, ...(selectedText === undefined ? {} : { selectedText }) };
  }
  /** Ephemeral forks own independent journals: closing either chat must not erase the other. */
  private async forkEphemeral(entryId: string, position: "before" | "at"): Promise<{ cancelled: boolean; selectedText?: string }> {
    const outgoing = this.result;
    const session = outgoing.session;
    await session.journal.project();
    const target = await session.nativeHistory.prepareFork(entryId, BACKGROUND_CONTEXT);
    const conversation = await session.journal.harness.conversation(target.conversationId, BACKGROUND_CONTEXT);
    if (conversation === undefined) throw new Error("Missing ephemeral fork conversation");
    let cursor: Cursor | undefined;
    let sdkId: string | undefined;
    let found = false;
    do {
      const page = await conversation.entries({ order: "ascending" }, 256, cursor, BACKGROUND_CONTEXT);
      for (const item of page.items) {
        sdkId = session.journal.sdkEntryId(item, item.id === target.entryId ? target.messageIndex : Math.max(0, (item.model?.length ?? 1) - 1)) ?? sdkId;
        if (item.id === target.entryId) { found = true; break; }
      }
      cursor = page.next;
    } while (cursor !== undefined && !found);
    const entry = sdkId === undefined ? undefined : session.sessionManager.getEntry(sdkId);
    if (!found || position === "before" && entry === undefined) throw new Error("Missing ephemeral fork transcript entry");
    if (position === "before" && entry !== undefined && (entry.type !== "message" || entry.message.role !== "user")) throw new Error("Only a user message can be forked before its entry");
    const leaf = entry === undefined ? null : position === "before" ? entry.parentId : entry.id;
    const selectedText = position === "before" && entry?.type === "message" && entry.message.role === "user"
      ? typeof entry.message.content === "string" ? entry.message.content : entry.message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n") : undefined;
    const manager = SessionManager.create(this.cwd, session.sessionManager.getSessionDir());
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Ephemeral fork requires persistent storage");
    const branch = leaf === null ? [] : session.sessionManager.getBranch(leaf);
    await writeFile(file, [manager.getHeader(), ...branch].map(value => JSON.stringify(value)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    const replacement = SessionManager.open(file, dirname(file));
    // Do not pass the source's handle: import the copied branch into its own journal.
    const options = { ...this.options };
    delete options.handle;
    const candidate = await this.create({ ...options, sessionManager: replacement,
      sessionStartEvent: { type: "session_start", reason: "fork", ...(session.sessionFile === undefined ? {} : { previousSessionFile: session.sessionFile }) } });
    try {
      this.result = candidate;
      await this.rebind?.(this.session);
    } catch (error) {
      this.result = outgoing;
      await this.closeResult(candidate);
      throw error;
    }
    await this.closeResult(outgoing);
    return { cancelled: false, ...(selectedText === undefined ? {} : { selectedText }) };
  }
  private async forkNative(entryId: string, position: "before" | "at"): Promise<{ cancelled: boolean; selectedText?: string }> {
    const outgoing = this.result;
    const previousSessionFile = outgoing.session.sessionFile;
    const native = await createNativeForkCandidate(outgoing.session.journal.nativeHistory, entryId, position, randomUUID(), BACKGROUND_CONTEXT, async (handle) => {
      const manager = SessionManager.create(this.cwd, outgoing.session.sessionManager.getSessionDir(), { id: handle.address.sessionId });
      const candidate = await this.create({ ...this.options, handle, nativeForks: true, sessionManager: manager,
        sessionStartEvent: { type: "session_start", reason: "fork", ...(previousSessionFile === undefined ? {} : { previousSessionFile }) } });
      if (candidate.session.journal.handle.conversation.id !== handle.conversation.id || candidate.session.journal.harness !== handle.harness) {
        await this.closeResult(candidate);
        throw new Error("Runtime factory did not bind the native candidate handle");
      }
      return candidate;
    });
    try {
      // Rebind while the outgoing lease still exists. Failed candidate construction or
      // rebind cannot invalidate the original session or stop a sibling Harness.
      this.result = native.candidate;
      await this.rebind?.(this.session);
    } catch (error) {
      this.result = outgoing;
      try { await this.closeResult(native.candidate); }
      finally { await native.handle.release(BACKGROUND_CONTEXT); }
      throw error;
    }
    await this.closeResult(outgoing);
    return { cancelled: false, ...(native.selectedText === undefined ? {} : { selectedText: native.selectedText }) };
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeResult(this.result);
  }
  private async closeResult(result: DurableRuntimeResult): Promise<void> {
    // SDK disposal invalidates extension callbacks without necessarily emitting session_shutdown.
    result.services.workspaceServicesObserver?.dispose();
    await result.session.close();
  }
}

/** Candidate construction owns the acquired lease until the new runtime takes it. */
export async function createNativeForkCandidate<T>(history: DurableNativeHistory, entryId: string, position: "before" | "at", newSessionId: string,
  context: Context, create: (handle: DurableSessionHandle) => Promise<T>): Promise<{ candidate: T; handle: DurableSessionHandle; selectedText?: string }> {
  const forked = await history.fork(entryId, position, newSessionId, context);
  try { return { candidate: await create(forked.handle), ...forked }; }
  catch (error) { await forked.handle.release(BACKGROUND_CONTEXT); throw error; }
}
