import { z } from "zod";
import { attentionKindSchema, attentionUrgencySchema, type AttentionHint } from "../../shared/attentionHints.js";
import type { DecisionHints } from "./decisionHints.js";
import type { DecisionRequest } from "./decisionClient.js";

export const ATTENTION_HINT_CUSTOM_TYPE = "forgerie.attention-hint.v1";
const probability = z.number().min(0).max(1);
const storedHintSchema = z.object({
  version: z.literal(1), turnId: z.string(), model: z.string(), at: z.string(),
  kind: z.object({ value: attentionKindSchema, confidence: probability }),
  urgency: z.object({ value: attentionUrgencySchema, confidence: probability }),
  asksUser: probability, stoppedEarly: probability,
});
type StoredHint = z.infer<typeof storedHintSchema>;
interface HintState { suppressed: boolean; canSettle: boolean; asked?: string; hint?: StoredHint }
const entrySchema = z.object({ type: z.string(), id: z.string().optional(), customType: z.string().optional(), data: z.unknown().optional(), message: z.object({ role: z.string() }).loose().optional() }).loose();
const replySchema = z.object({ role: z.literal("assistant"), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()) });
export interface AttentionSession {
  branch(): readonly unknown[];
  messages(): readonly unknown[];
  awaiting(): string;
  persist(data: StoredHint | { version: 1; invalidated: true }): Promise<void>;
  publish(): void;
}

/** Metadata entries do not advance the turn. A delivered user message or run start does. */
function turnId(session: AttentionSession): string | undefined {
  for (const raw of [...session.branch()].reverse()) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (entry.type === "message" || (entry.customType === "forgerie.session-response.v1" && z.object({ kind: z.literal("started") }).safeParse(entry.data).success)) {
      return entry.id ?? JSON.stringify(raw);
    }
  }
  return undefined;
}
function storedHint(session: AttentionSession): StoredHint | undefined {
  for (const raw of [...session.branch()].reverse()) {
    const entry = entrySchema.safeParse(raw);
    if (entry.success && entry.data.customType === ATTENTION_HINT_CUSTOM_TYPE) {
      const hint = storedHintSchema.safeParse(entry.data.data);
      return hint.success ? hint.data : undefined;
    }
  }
  return undefined;
}
const questions: DecisionRequest["questions"] = {
  kind: { type: "choice", instructions: "Classify the final reply.", criteria: {
    decision: "A user decision or approval is needed", review: "Work is ready for user review", blocked: "Work cannot proceed", failed: "Work failed", done: "Work is complete", fyi: "Information only",
  } },
  asks_user: { type: "noul", instructions: "Does this reply ask the user to answer, decide or approve?" },
  urgency: { type: "score", instructions: "How urgently does this reply need attention?", criteria: ["low", "normal", "high"] },
  stopped_early: { type: "noul", instructions: "Does this reply promise or announce work it did not do in this turn?" },
};
const thresholds = { high: 0.6, normal: 0.75, low: 0.9 };
const DISPLAY_CONFIDENCE = 0.75;

/** Owns detached asks and their invalidation. It never changes the declared response. */
export class AttentionHints {
  private closed = false;
  dispose(): void { this.closed = true; }
  private readonly states = new WeakMap<AttentionSession, HintState>();
  constructor(private readonly deps: DecisionHints | undefined, private readonly onError: (error: unknown) => void, private readonly now: () => Date) {}

  configured(): boolean { return this.deps !== undefined; }

  restore(session: AttentionSession, data: unknown): void {
    const parsed = storedHintSchema.safeParse(data);
    this.states.set(session, { suppressed: !parsed.success, canSettle: true, ...(parsed.success ? { hint: parsed.data } : {}) });
  }

  invalidate(session: AttentionSession): void {
    const old = this.states.get(session);
    this.states.set(session, { suppressed: true, canSettle: false });
    // A tombstone prevents queued input from reviving a hint after restart.
    if (old?.asked !== undefined || old?.hint !== undefined || storedHint(session) !== undefined) {
      void session.persist({ version: 1, invalidated: true }).catch(this.onError);
    }
  }

  started(session: AttentionSession): void {
    this.invalidate(session);
    this.states.set(session, { suppressed: true, canSettle: true });
  }

  read(session: AttentionSession): AttentionHint | undefined {
    const settings = this.deps?.readSettings();
    if (settings?.enabled !== true || !settings.attention || !settings.baseUrl) return undefined;
    const state = this.states.get(session);
    if (state?.suppressed === true) return undefined;
    const hint = state?.hint ?? storedHint(session);
    if (hint === undefined || hint.turnId !== turnId(session)) return undefined;
    return { turnId: hint.turnId, model: hint.model, at: hint.at,
      likelyNeedsYou: Math.max(hint.asksUser, hint.stoppedEarly) >= thresholds[settings.sensitivity],
      ...(hint.kind.confidence >= DISPLAY_CONFIDENCE ? { kind: hint.kind.value } : {}),
      ...(hint.urgency.confidence >= DISPLAY_CONFIDENCE ? { urgency: hint.urgency.value } : {}),
    };
  }

  settled(session: AttentionSession): void {
    const settings = this.deps?.readSettings();
    if (this.closed || settings?.enabled !== true || !settings.attention || !settings.baseUrl || this.deps === undefined) return;
    const id = turnId(session);
    if (id === undefined) return;
    const old = this.states.get(session);
    if (old?.asked === id || old?.canSettle === false) return;
    let reply: unknown;
    for (const message of [...session.messages()].reverse()) {
      if (z.object({ role: z.literal("user") }).safeParse(message).success) break;
      if (replySchema.safeParse(message).success) { reply = message; break; }
    }
    const parsed = replySchema.safeParse(reply);
    const text = parsed.success ? parsed.data.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim().slice(0, 8192) : "";
    const state: HintState = { suppressed: false, canSettle: true, asked: id };
    this.states.set(session, state);
    const current = () => {
      const live = this.deps?.readSettings();
      return !this.closed && this.states.get(session) === state && turnId(session) === id && live?.enabled === true && live.attention && live.baseUrl !== "";
    };
    void this.deps.client.ask({ model: settings.model, state: { reply: text, awaiting: session.awaiting() }, questions }).then(async (result) => {
      if (result === undefined || !current()) return;
      const { kind, asks_user: asksUser, urgency, stopped_early: stoppedEarly } = result.answers;
      if (kind?.type !== "choice" || asksUser?.type !== "noul" || urgency?.type !== "score" || stoppedEarly?.type !== "noul") return;
      const hint = storedHintSchema.safeParse({ version: 1, turnId: id, model: result.model, at: this.now().toISOString(),
        kind: { value: kind.choice, confidence: kind.confidence }, asksUser: asksUser.noul, stoppedEarly: stoppedEarly.noul,
        urgency: { value: ["low", "normal", "high"][Math.round(urgency.score)], confidence: urgency.confidence },
      });
      if (!hint.success) return;
      await session.persist(hint.data);
      if (!current()) return;
      state.hint = hint.data;
      session.publish();
    }).catch(this.onError);
  }
}
