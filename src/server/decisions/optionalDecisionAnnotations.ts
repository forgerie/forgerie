import { z } from "zod";
import type { JsonValue } from "@earendil-works/chord";
import { Check } from "typebox/value";
import { RISK_LABEL_ENTRY_KIND, RiskLabelEntrySchema, riskToolIdentity, type RiskLabelEntry } from "../../shared/riskLabels.js";

// Bounds apply to the whole family, not independently to each conversation.
export const DECISION_ANNOTATION_MAX_RECORDS = 2048;
export const DECISION_ANNOTATION_MAX_BYTES = 2 * 1024 * 1024;
interface AnnotationRecord {scope: string; key: string; value: JsonValue; bytes: number}

/** Volatile, bounded sidecar. It never calls Durable or storage methods. */
class OptionalDecisionAnnotations {
  private readonly records = new Map<string, AnnotationRecord>();
  private readonly listeners = new Set<(scope: string, key: string) => void>();
  private riskVisibility: (() => boolean) | undefined;
  private bytes = 0;
  private closed = false;
  write(scope: string, key: string, value: JsonValue): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.closed) return;
      const bytes = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(scope) + Buffer.byteLength(key) + 64;
      if (bytes > DECISION_ANNOTATION_MAX_BYTES) return;
      const id = JSON.stringify([scope, key]);
      const copied = structuredClone(value);
      this.bytes -= this.records.get(id)?.bytes ?? 0;
      this.records.set(id, {scope, key, value: copied, bytes});
      this.bytes += bytes;
      const changed: {scope: string; key: string}[] = [{scope, key}];
      while (this.records.size > DECISION_ANNOTATION_MAX_RECORDS || this.bytes > DECISION_ANNOTATION_MAX_BYTES) {
        const oldest = this.records.entries().next().value;
        if (oldest === undefined) break;
        this.records.delete(oldest[0]); this.bytes -= oldest[1].bytes; changed.push(oldest[1]);
      }
      for (const change of changed) for (const listener of this.listeners) listener(change.scope, change.key);
    });
  }
  read(scope: string, key: string): JsonValue | undefined { return structuredClone(this.records.get(JSON.stringify([scope, key]))?.value); }
  values(scope: string): JsonValue[] { return structuredClone([...this.records.values()].filter(record => record.scope === scope).map(record => record.value)); }
  setRiskVisibility(read: () => boolean): void { if (!this.closed) this.riskVisibility = read; }
  riskVisible(): boolean { return !this.closed && this.riskVisibility?.() === true; }
  subscribe(listener: (scope: string, key: string) => void): () => void {
    if (this.closed) return () => { this.listeners.delete(listener); };
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  close(): void {
    this.closed = true; this.records.clear(); this.listeners.clear(); this.riskVisibility = undefined; this.bytes = 0;
  }
}

const stores = new WeakMap<object, OptionalDecisionAnnotations>();
export function decisionAnnotations(owner: object): OptionalDecisionAnnotations {
  let store = stores.get(owner);
  if (store === undefined) { store = new OptionalDecisionAnnotations(); stores.set(owner, store); }
  return store;
}
/** Keep the closed tombstone so a late callback cannot recreate the family's store. */
export function closeDecisionAnnotations(owner: object): void { decisionAnnotations(owner).close(); }
export function riskAnnotations(owner: object, conversation: number): RiskLabelEntry[] {
  const store = decisionAnnotations(owner); const scope = String(conversation);
  return store.riskVisible() ? store.values(scope).filter(value => Check(RiskLabelEntrySchema, value)) : [];
}
/** Legacy event transport only. History uses metadata on existing messages, never synthetic rows. */
export function riskAnnotationMessages(owner: object, conversation: number) {
  return riskAnnotations(owner, conversation).filter(entry => entry.target === "tool").map(entry => ({
    id: `risk:${entry.invocationId}`, role: "custom" as const, customType: RISK_LABEL_ENTRY_KIND,
    content: "Risk opinion (not approval)", display: true, timestamp: 0, details: entry,
  }));
}

const callsSchema = z.object({role: z.literal("assistant"), forgerieDurableEntryId: z.number().optional(),
  toolInvocations: z.record(z.string(), z.string()).optional(), content: z.array(z.object({type: z.string(), id: z.string().optional()}))});
/** Stable presentation identity, including when the optional feature is off. */
export function withToolInvocationIds<T extends {role: string}>(conversation: number, messages: readonly T[], sourceEntry?: number): (T & {toolInvocations?: Record<string, string>})[] {
  return messages.map(message => {
    const calls = callsSchema.safeParse(message);
    if (!calls.success) return message;
    const assistant = sourceEntry ?? calls.data.forgerieDurableEntryId;
    const invocations = assistant === undefined ? calls.data.toolInvocations : Object.fromEntries(calls.data.content.flatMap((part): [string, string][] =>
      part.type === "toolCall" && part.id !== undefined ? [[part.id, riskToolIdentity(conversation, assistant, part.id).invocationId]] : []));
    return invocations === undefined || Object.keys(invocations).length === 0 ? message : {...message, toolInvocations: invocations};
  });
}

/** Count-preserving metadata projection, called after required pagination and validation. */
export function withRiskAnnotations<T extends {role: string}>(owner: object, conversation: number, messages: readonly T[]): (T & {
  toolInvocations?: Record<string, string>; decisionAnnotations?: RiskLabelEntry[];
})[] {
  const labels = riskAnnotations(owner, conversation);
  return withToolInvocationIds(conversation, messages).map(message => {
    const ids = new Set(Object.values(message.toolInvocations ?? {}));
    const annotations = labels.filter(label => label.target === "tool" && ids.has(label.sourceInvocationId));
    return annotations.length === 0 ? message : {...message, decisionAnnotations: annotations};
  });
}
