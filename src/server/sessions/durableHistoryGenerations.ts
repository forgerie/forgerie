import { randomUUID } from "node:crypto";
import type { ConversationId, Harness, Seq } from "@earendil-works/pi-durable";
import { Presentation } from "./durableParentDocuments.js";
import { conversationDocumentChanges, createHarnessCommitObserver } from "./durableHarnessObservers.js";

interface HistoryGenerations {
  incarnation: string;
  corrections: Map<ConversationId, Seq>;
}

/** Epoch-owned identities, shared by cold reads and publishers for the whole Harness lifetime. */
export class DurableHistoryGenerations {
  // Keep observing after the last socket detaches: a correction between connections must
  // invalidate the browser's prefix too.
  private readonly historyFor = createHarnessCommitObserver<HistoryGenerations>(
    () => ({ incarnation: randomUUID(), corrections: new Map() }),
    (history, publication) => {
      const presentations = conversationDocumentChanges(publication, Presentation.definition.kind);
      if (presentations.length === 0) return;
      const appended = new Set(publication.changes.flatMap(change => change.type === "entry"
        ? [`${String(change.value.conversationId)}:${String(change.value.id)}`] : []));
      for (const change of presentations) {
        // Entry and envelope creation in the same commit are one append. An envelope
        // created/changed/retired later changes an already addressable presentation.
        if (!appended.has(`${String(change.conversationId)}:${change.record.key ?? ""}`)) {
          history.corrections.set(change.conversationId, publication.seq);
        }
      }
    },
  );

  identify(journalId: string, harness: Harness, conversationId: ConversationId): string {
    const history = this.historyFor(harness);
    return `native:${journalId}:${String(conversationId)}:${history.incarnation}:${String(history.corrections.get(conversationId) ?? 0)}`;
  }
}
