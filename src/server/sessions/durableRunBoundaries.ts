import { LiveDoc, type ConversationId, type Harness } from "@earendil-works/pi-durable";

interface RunBoundary {
  known: boolean;
  taskId: number | undefined;
  startSeq: number;
}

/** Keep the latest observed committed run boundary even when a run ends between replacement frames. */
export class DurableRunBoundaries {
  private readonly harnesses = new WeakMap<Harness, Map<ConversationId, Map<string, RunBoundary>>>();
  constructor(private readonly advance: (sessionId: string) => number) {}

  observe(sessionId: string, harness: Harness, conversationId: ConversationId): RunBoundary {
    let conversations = this.harnesses.get(harness);
    if (conversations === undefined) {
      conversations = new Map(); this.harnesses.set(harness, conversations);
      const observed = conversations;
      // One lifetime observer, not one listener for every session ever opened in this family.
      harness.subscribeCommits(publication => {
        for (const change of publication.changes) {
          if ((change.type !== "document" && change.type !== "document.copy") || change.conversationId === undefined || change.record.kind !== LiveDoc.definition.kind) continue;
          const sessions = observed.get(change.conversationId);
          if (sessions === undefined) continue;
          if (change.type === "document.copy" || change.value === null) { for (const state of sessions.values()) state.known = false; continue; }
          const run = change.value["run"];
          const taskId = typeof run === "object" && run !== null && !Array.isArray(run) && typeof run["taskId"] === "number" ? run["taskId"] : undefined;
          for (const [logicalId, state] of sessions) {
            if (state.known && taskId !== undefined && taskId !== state.taskId) state.startSeq = this.advance(logicalId);
            state.known = true; state.taskId = taskId;
          }
        }
      });
    }
    let sessions = conversations.get(conversationId);
    if (sessions === undefined) { sessions = new Map(); conversations.set(conversationId, sessions); }
    let state = sessions.get(sessionId);
    if (state === undefined) { state = { known: false, taskId: undefined, startSeq: 0 }; sessions.set(sessionId, state); }
    return state;
  }

  checkpoint(sessionId: string, harness: Harness, conversationId: ConversationId, taskId: number | undefined): number {
    const state = this.observe(sessionId, harness, conversationId);
    // An already active run at first attachment has no observed start watermark. Do not
    // invent one at read time: it could erase a valid error already emitted by that run.
    state.known = true; state.taskId = taskId;
    return state.startSeq;
  }
}
