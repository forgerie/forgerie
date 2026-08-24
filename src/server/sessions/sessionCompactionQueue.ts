import type { ImageContent } from "@earendil-works/pi-ai";
import type { QueuedSessionMessage } from "../../shared/apiTypes.js";

export type QueuedPromptKind = "steer" | "followUp";

export interface QueuedPrompt {
  kind: QueuedPromptKind;
  text: string;
  images?: ImageContent[];
  echoUserMessage?: boolean;
  expandPromptTemplates?: boolean;
}

export interface QueuedCompactionHandle {
  readonly sessionId: string;
  readonly text: string;
  readonly token: symbol;
}

interface QueuedCompaction {
  text: string;
  phase: "queued" | "checking" | "running";
  followingPrompts: QueuedPrompt[];
  token: symbol;
}

/** Owns the ordering boundary between prompts before and after queued compaction. */
export class SessionCompactionQueue {
  private readonly promptQueues = new Map<string, QueuedPrompt[]>();
  private readonly compactions = new Map<string, QueuedCompaction>();

  queueCompaction(sessionId: string, text: string): boolean {
    if (this.compactions.has(sessionId)) return false;
    this.compactions.set(sessionId, { text, phase: "queued", followingPrompts: [], token: Symbol(sessionId) });
    return true;
  }

  hasCompactionBoundary(sessionId: string): boolean {
    return this.compactions.has(sessionId);
  }

  isCompactionQueued(sessionId: string): boolean {
    return this.compactions.get(sessionId)?.phase === "queued";
  }

  isCompactionRunning(sessionId: string): boolean {
    const phase = this.compactions.get(sessionId)?.phase;
    return phase === "checking" || phase === "running";
  }

  startCompaction(sessionId: string): QueuedCompactionHandle | undefined {
    const queued = this.compactions.get(sessionId);
    if (queued?.phase !== "queued") return undefined;
    queued.phase = "checking";
    return { sessionId, text: queued.text, token: queued.token };
  }

  deferCompaction(handle: QueuedCompactionHandle): boolean {
    const queued = this.compactions.get(handle.sessionId);
    if (queued?.token !== handle.token || queued.phase !== "checking") return false;
    queued.phase = "queued";
    return true;
  }

  commitCompactionStart(handle: QueuedCompactionHandle): boolean {
    const queued = this.compactions.get(handle.sessionId);
    if (queued?.token !== handle.token || queued.phase !== "checking") return false;
    queued.phase = "running";
    return true;
  }

  finishCompaction(sessionId: string): void {
    const queued = this.compactions.get(sessionId);
    if (queued === undefined || queued.phase === "queued") return;
    this.compactions.delete(sessionId);
    this.appendReadyPrompts(sessionId, queued.followingPrompts);
  }

  failCompaction(handle: QueuedCompactionHandle): boolean {
    const queued = this.compactions.get(handle.sessionId);
    if (queued?.token !== handle.token || queued.phase === "queued") return false;
    this.compactions.delete(handle.sessionId);
    this.appendReadyPrompts(handle.sessionId, queued.followingPrompts);
    return true;
  }

  enqueuePrompt(sessionId: string, prompt: QueuedPrompt): void {
    const queued = this.compactions.get(sessionId);
    if (queued !== undefined) queued.followingPrompts.push(prompt);
    else this.appendReadyPrompts(sessionId, [prompt]);
  }

  hasReadyPrompts(sessionId: string): boolean {
    return this.promptQueues.has(sessionId);
  }

  readyPromptCount(sessionId: string): number {
    return this.readyPrompts(sessionId).length;
  }

  takeReadyPrompts(sessionId: string): QueuedPrompt[] {
    const prompts = this.promptQueues.get(sessionId) ?? [];
    this.promptQueues.delete(sessionId);
    return prompts;
  }

  shiftReadyPrompt(sessionId: string): QueuedPrompt | undefined {
    const queue = this.promptQueues.get(sessionId);
    const prompt = queue?.shift();
    if (queue === undefined || queue.length === 0) this.promptQueues.delete(sessionId);
    return prompt;
  }

  pendingCount(sessionId: string): number {
    const queued = this.compactions.get(sessionId);
    return this.readyPromptCount(sessionId)
      + (queued?.followingPrompts.length ?? 0)
      + (queued?.phase === "queued" || queued?.phase === "checking" ? 1 : 0);
  }

  queuedMessages(sessionId: string, runtimeMessages: readonly QueuedSessionMessage[]): QueuedSessionMessage[] {
    const queued = this.compactions.get(sessionId);
    return [
      ...runtimeMessages,
      ...this.readyPrompts(sessionId).map(queuedPromptMessage),
      ...(queued?.phase === "queued" || queued?.phase === "checking" ? [{ kind: "followUp" as const, text: queued.text }] : []),
      ...(queued?.followingPrompts.map(queuedPromptMessage) ?? []),
    ];
  }

  clear(sessionId: string): void {
    this.promptQueues.delete(sessionId);
    this.compactions.delete(sessionId);
  }

  clearAll(): void {
    this.promptQueues.clear();
    this.compactions.clear();
  }

  private readyPrompts(sessionId: string): readonly QueuedPrompt[] {
    return this.promptQueues.get(sessionId) ?? [];
  }

  private appendReadyPrompts(sessionId: string, prompts: readonly QueuedPrompt[]): void {
    if (prompts.length === 0) return;
    const queue = this.promptQueues.get(sessionId) ?? [];
    queue.push(...prompts);
    this.promptQueues.set(sessionId, queue);
  }
}

function queuedPromptMessage(prompt: QueuedPrompt): QueuedSessionMessage {
  return { kind: prompt.kind, text: prompt.text };
}
