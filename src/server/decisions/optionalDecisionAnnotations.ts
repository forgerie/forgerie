import { z } from "zod";
import type { JsonValue } from "@earendil-works/chord";
import { Check } from "typebox/value";
import { RISK_LABEL_ENTRY_KIND, RiskLabelEntrySchema, type RiskLabelEntry } from "../../shared/riskLabels.js";

/** A separate, volatile store. The owner is only an identity: no Durable or storage
 * methods are called. A failed write or listener cannot poison a required journal.
 */
class OptionalDecisionAnnotations {
  private readonly scopes = new Map<string, Map<string, JsonValue>>();
  private readonly listeners = new Set<(scope: string, key: string) => void>();
  write(scope: string, key: string, value: JsonValue): Promise<void> {
    return Promise.resolve().then(() => {
      const copied = structuredClone(value);
      let records = this.scopes.get(scope);
      if (records === undefined) { records = new Map(); this.scopes.set(scope, records); }
      records.set(key, copied);
      for (const listener of this.listeners) listener(scope, key);
    });
  }
  read(scope: string, key: string): JsonValue | undefined { return structuredClone(this.scopes.get(scope)?.get(key)); }
  values(scope: string): JsonValue[] { return structuredClone([...this.scopes.get(scope)?.values() ?? []]); }
  subscribe(listener: (scope: string, key: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

// One store per live session family. Weak ownership releases it with its harness;
// a reopened family gets an empty store, never an annotation from the journal.
const stores = new WeakMap<object, OptionalDecisionAnnotations>();
export function decisionAnnotations(owner: object): OptionalDecisionAnnotations {
  let store = stores.get(owner);
  if (store === undefined) { store = new OptionalDecisionAnnotations(); stores.set(owner, store); }
  return store;
}
export function riskAnnotations(owner: object, conversation: number): RiskLabelEntry[] {
  return decisionAnnotations(owner).values(String(conversation)).filter(value => Check(RiskLabelEntrySchema, value));
}
/** Display-only records fold into their source call, never into model context or required history. */
export function riskAnnotationMessages(owner: object, conversation: number) {
  return riskAnnotations(owner, conversation).filter(entry => entry.target === "tool").map(entry => ({
    id: `risk:${String(conversation)}:${entry.id}`, role: "custom" as const, customType: RISK_LABEL_ENTRY_KIND,
    content: "Risk opinion (not approval)", display: true, timestamp: 0, details: entry,
  }));
}

const callsSchema = z.object({ role: z.literal("assistant"), content: z.array(z.object({ type: z.string(), id: z.string().optional() })) });
/** Keep annotations next to their source turn. Appending every old label to the
 * tail would crowd required messages out of the newest bounded history page.
 */
export function withRiskAnnotations<T extends { role: string }>(owner: object, conversation: number, messages: readonly T[]) {
  const labels = riskAnnotationMessages(owner, conversation);
  if (labels.length === 0) return [...messages];
  return messages.flatMap((message): (T | typeof labels[number])[] => {
    const calls = callsSchema.safeParse(message);
    if (!calls.success) return [message];
    const ids = calls.data.content.filter(part => part.type === "toolCall").flatMap(part => part.id === undefined ? [] : [part.id]);
    return [message, ...labels.filter(label => ids.some(id => label.details.id === id || label.details.id.startsWith(`${id}/`)))];
  });
}
