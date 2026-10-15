import { randomUUID } from "node:crypto";
import type { ConversationId, Harness, Seq } from "@earendil-works/pi-durable";
import { Presentation } from "./durableParentDocuments.js";

interface HistoryGenerations {
  incarnation: string;
  corrections: Map<ConversationId, Seq>;
}

/** Epoch-owned identities, shared by cold reads and publishers for the whole Harness lifetime. */
export class DurableHistoryGenerations {
  private readonly harnesses = new WeakMap<Harness, HistoryGenerations>();

  identify(journalId: string, harness: Harness, conversationId: ConversationId): string {
    let history = this.harnesses.get(harness);
    if (history === undefined) {
      history = { incarnation: randomUUID(), corrections: new Map() };
      this.harnesses.set(harness, history);
      const observed = history;
      // Keep observing after the last socket detaches: a correction between connections must
      // invalidate the browser's prefix too. The weak key gives this the Harness's lifetime.
      harness.subscribeCommits(publication => {
        const presentations = publication.changes.filter(change => (change.type === "document" || change.type === "document.copy")
          && change.record.kind === Presentation.definition.kind && change.conversationId !== undefined);
        if (presentations.length === 0) return;
        const appended = new Set(publication.changes.flatMap(change => change.type === "entry"
          ? [`${String(change.value.conversationId)}:${String(change.value.id)}`] : []));
        for (const change of presentations) {
          if (change.type !== "document" && change.type !== "document.copy" || change.conversationId === undefined) continue;
          // Entry and envelope creation in the same commit are one append. An envelope
          // created/changed/retired later changes an already addressable presentation.
          if (!appended.has(`${String(change.conversationId)}:${change.record.key ?? ""}`)) {
            observed.corrections.set(change.conversationId, publication.seq);
          }
        }
      });
    }
    return `native:${journalId}:${String(conversationId)}:${history.incarnation}:${String(history.corrections.get(conversationId) ?? 0)}`;
  }
}
