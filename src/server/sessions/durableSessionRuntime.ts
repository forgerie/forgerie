import { dirname } from "node:path";
import { SessionManager, type SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { PiAgentSession, PiSessionRuntime } from "./piSessionService.js";
import { DurableAgentSession } from "./durableAgentSession.js";

export interface DurableRuntimeOptions {
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
    try { await this.session.close(); }
    catch (error) { await candidate.session.close(); throw error; }
    this.result = candidate;
    await this.rebind?.(this.session);
    return { cancelled: false, ...(selectedText === undefined ? {} : { selectedText }) };
  }
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.session.close();
  }
}
