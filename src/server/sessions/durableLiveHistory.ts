import { Check } from "typebox/value";
import { AgentDoc, InboxDoc, LiveDoc, UsageDoc, type CommitPublication, type EntryRecord } from "@earendil-works/pi-durable";
import type { Static } from "typebox";
import type { DurableBrowserMessage } from "../../shared/durableBrowserSnapshot.js";
import { ParentAsks, ParentResponse, Presentation, PresentationSchema, SessionName } from "./durableParentDocuments.js";
import { SessionBindings } from "./durableSessionBindings.js";
import type { DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";

type Envelopes = Map<string, Static<typeof PresentationSchema>>;
interface History {
  entries: Map<string, EntryRecord>;
  messages: DurableBrowserMessage[];
  envelopes: Envelopes;
  bound: boolean;
}
const parentKinds = new Set([LiveDoc.definition.kind, InboxDoc.definition.kind, AgentDoc.definition.kind, UsageDoc.definition.kind,
  ParentAsks.definition.kind, ParentResponse.definition.kind, SessionName.definition.kind, Presentation.definition.kind]);

/** Only sources consumed by an open cut can invalidate its replacement. Task/alias/family traffic cannot. */
export function nativeOpenChanged(publication: CommitPublication, address: DurableSessionAddress): boolean {
  return publication.changes.some(change => {
    if (change.type === "entry") return change.value.conversationId === address.conversationId;
    if (change.type !== "document" && change.type !== "document.copy") return false;
    if (change.conversationId === address.conversationId) return parentKinds.has(change.record.kind);
    if (change.type !== "document" || change.record.kind !== SessionBindings.definition.kind) return false;
    if (change.value === null) return true;
    const sessions = change.value["sessions"];
    if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) return true;
    const binding = sessions[address.sessionId];
    return typeof binding !== "object" || binding === null || Array.isArray(binding) || binding["conversationId"] !== address.conversationId;
  });
}

/** One derived history per live publisher, updated synchronously by adopted immutable commits. */
export class DurableLiveHistory {
  private state: History | undefined;
  private failure: Error | undefined;
  private readonly stop: () => void;
  constructor(handle: DurableSessionHandle, private readonly project: (entry: EntryRecord, envelope: Static<typeof PresentationSchema>["envelope"]) => DurableBrowserMessage[]) {
    this.stop = handle.harness.subscribeCommits(publication => {
      const state = this.state;
      if (state === undefined) return; // The initial transaction scans the latest committed history.
      const appended: EntryRecord[] = [];
      let rebuild = false;
      try {
        for (const change of publication.changes) {
          if (change.type === "entry" && change.value.conversationId === handle.conversation.id) {
            if (state.entries.has(String(change.value.id))) rebuild = true;
            else appended.push(change.value);
            state.entries.set(String(change.value.id), change.value);
          }
          if (change.type !== "document" && change.type !== "document.copy") continue;
          if (change.type === "document" && change.value === null && (change.record.kind === SessionBindings.definition.kind
            || change.conversationId === handle.conversation.id && parentKinds.has(change.record.kind))) { this.state = undefined; return; }
          if (change.conversationId !== handle.conversation.id) continue;
          if (change.type === "document.copy" && parentKinds.has(change.record.kind)) { this.state = undefined; return; }
          if (change.type !== "document" || change.record.kind !== Presentation.definition.kind || change.record.key === undefined) continue;
          if (!Check(PresentationSchema, change.value)) throw new Error("Invalid committed native presentation document");
          state.envelopes.set(change.record.key, change.value);
          if (state.entries.has(change.record.key) && !appended.some(entry => String(entry.id) === change.record.key)) rebuild = true;
        }
        if (rebuild) state.messages = [...state.entries.values()].flatMap(entry => this.project(entry, state.envelopes.get(String(entry.id))?.envelope));
        else for (const entry of appended) state.messages.push(...this.project(entry, state.envelopes.get(String(entry.id))?.envelope));
      } catch (error) { this.failure = error instanceof Error ? error : new Error(String(error)); }
    });
  }
  get value(): History | undefined {
    if (this.failure !== undefined) throw this.failure;
    return this.state;
  }
  seed(entries: readonly EntryRecord[], envelopes: Envelopes, messages: DurableBrowserMessage[], bound: boolean): void {
    this.state = { entries: new Map(entries.map(entry => [String(entry.id), entry])), envelopes, messages, bound };
  }
  close(): void { this.stop(); this.state = undefined; }
}
