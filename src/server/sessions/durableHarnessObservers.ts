import type { CommitPublication, ConversationId, DocumentCommitChange, Harness } from "@earendil-works/pi-durable";

export function createHarnessCommitObserver<State extends object>(
  createState: () => State,
  onCommit: (state: State, publication: CommitPublication) => void,
): (harness: Harness) => State {
  // One lifetime observer per Harness, not one listener for every session ever opened.
  // The weak key keeps the state from retaining the Harness after its lifetime ends.
  const harnesses = new WeakMap<Harness, State>();
  return harness => {
    let state = harnesses.get(harness);
    if (state === undefined) {
      const observed = createState();
      harnesses.set(harness, observed);
      harness.subscribeCommits(publication => { onCommit(observed, publication); });
      state = observed;
    }
    return state;
  };
}

type ConversationDocumentChange = DocumentCommitChange & { readonly conversationId: ConversationId };

export function conversationDocumentChanges(publication: CommitPublication, kind: string): ConversationDocumentChange[] {
  return publication.changes.filter((change): change is ConversationDocumentChange =>
    (change.type === "document" || change.type === "document.copy")
    && change.record.kind === kind && change.conversationId !== undefined);
}
