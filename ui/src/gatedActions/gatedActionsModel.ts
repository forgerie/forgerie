import { riskLabelSchema } from "../riskLabelsModel";
// Gated actions: tool calls Forgerie holds until the reader approves them (docs/adr/0003).
// The server side is the Durable `beforeTool` hook and the doc `forgerie.gated-actions` per conversation; the routes are
// GET /api/sessions/:id/gated-actions?cwd= and POST …/gated-actions/:gid/approve|refuse { cwd }.
// The wire types are src/shared/gatedActions.ts and src/shared/autonomyPolicy.ts: these schemas mirror them field for
// field, and gatedActionsParity.test.ts holds them to it.
import { z } from "zod";
import { gatedCategoryLabels } from "@shared/autonomyPolicy";
import type { PiMessage } from "../contracts";

/** The transcript entry the hook writes when it blocks a call. */
export const GATED_ACTION_TYPE = "forgerie.gated-action";

export const GATED_CATEGORIES = ["force-push", "push-default", "destroy-local", "delete-remote", "github-merge-close", "publish", "messages"] as const;
export const gatedCategorySchema = z.enum(GATED_CATEGORIES);
export type GatedCategory = z.infer<typeof gatedCategorySchema>;

/** The policy that says which categories are gated. Slice 4 makes it configurable; nothing in the browser reads it yet. */
export const autonomyPolicySchema = z.strictObject({
  version: z.literal(1),
  gated: z.strictObject({
    "force-push": z.boolean(), "push-default": z.boolean(), "destroy-local": z.boolean(), "delete-remote": z.boolean(),
    "github-merge-close": z.boolean(), publish: z.boolean(), messages: z.boolean(),
  }),
  autoPassStops: z.boolean(),
});
export type AutonomyPolicy = z.infer<typeof autonomyPolicySchema>;

export const gatedActionStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("waiting") }),
  /** Approved: Forgerie runs it now. The approve route answers this at once; the outcome comes on a later read. */
  z.strictObject({ kind: z.literal("approved") }),
  z.strictObject({ kind: z.literal("refused") }),
  /** `result` is the tool's whole JSON result: its content, details and diagnostics. */
  z.strictObject({ kind: z.literal("ran"), result: z.unknown(), at: z.number() }),
  z.strictObject({ kind: z.literal("failed"), error: z.string(), at: z.number() }),
]);
export type GatedActionState = z.infer<typeof gatedActionStateSchema>;
export const gatedActionSchema = z.strictObject({
  id: z.string(),
  /** The Durable conversation that made the call. */
  conversationId: z.number().int().min(1),
  /** Who asked: "parent", or "child <name>". */
  by: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  category: gatedCategorySchema,
  /** What the call does, in plain words. */
  description: z.string(),
  requestedAt: z.number(),
  state: gatedActionStateSchema,
  riskLabel: riskLabelSchema.optional(),
});
export const gatedActionsSchema = z.array(gatedActionSchema);
/** Spelled as the server spells it, so the two types compare equal. */
export type GatedAction = Omit<z.infer<typeof gatedActionSchema>, "state"> & { state: GatedActionState };

/** The entry's details, as the server writes them: enough to draw the card before the session's records are read. */
export const gatedActionEntrySchema = z.strictObject({
  id: z.string(),
  by: z.string(),
  tool: z.string(),
  category: gatedCategorySchema,
  description: z.string(),
  /** The shell command, or the tool and its arguments as JSON; at most 4000 characters. The record's `args` are whole. */
  command: z.string(),
  riskLabel: riskLabelSchema.optional(),
});
export type GatedActionEntry = z.infer<typeof gatedActionEntrySchema>;
/**
 * The same fields, read from a transcript message. The session file stamps its own bookkeeping fields into a custom
 * message's details, so the reader keeps the entry's fields and drops the rest.
 */
const transcriptEntrySchema = z.object({ ...gatedActionEntrySchema.shape, id: z.string().min(1) });

/** The gated action a transcript message records, if it is one. An entry this app cannot read is not one. */
export function gatedEntryOf(message: PiMessage): GatedActionEntry | undefined {
  if (message.role !== "custom" || message.customType !== GATED_ACTION_TYPE) return undefined;
  const details = transcriptEntrySchema.safeParse(message.details);
  return details.success ? details.data : undefined;
}

/** Each category's name, from src/shared/autonomyPolicy.ts. */
export const CATEGORY_LABEL: Record<GatedCategory, string> = gatedCategoryLabels;

/** What cannot be undone, by category: the reason the call waits for the reader. One sentence each. */
const CONSEQUENCE: Record<GatedCategory, string> = {
  "force-push": "It replaces the branch on the remote, and commits that exist only there are lost.",
  "push-default": "It changes the default branch on the remote for everyone who uses it.",
  "destroy-local": "It throws away work that is not committed, and Git cannot bring it back.",
  "delete-remote": "It deletes from the remote for everyone who uses it.",
  "github-merge-close": "It acts on GitHub in your name.",
  publish: "It publishes a version others can install, and a published version cannot be taken back.",
  messages: "It sends in your name, and a sent message cannot be recalled.",
};

/** The card's note on what Approve does. */
export function consequenceOf(category: GatedCategory): string {
  return `${CONSEQUENCE[category]} Approve runs it once, exactly as shown.`;
}

/** Who asked, in the reader's words: a child by its name, and the parent named as such. */
export function askerOf(by: string): string {
  if (by === "parent") return "the parent";
  const child = /^child (.+)$/su.exec(by)?.[1]?.trim();
  return child === undefined || child === "" ? by : child;
}

/** The fact at the end of the card's title line: the category, and who asked. */
export function gatedMeta(entry: Pick<GatedActionEntry, "by" | "category">): string {
  return `${CATEGORY_LABEL[entry.category]}, asked by ${askerOf(entry.by)}`;
}

/**
 * The call the card shows: for a shell call, the exact command from the record once it is read; otherwise the entry's
 * preview. `shell` says whether to draw it as a shell command.
 */
export function shownCall(entry: GatedActionEntry, record: GatedAction | undefined): { code: string; shell: boolean } {
  const command = record?.args["command"];
  if (entry.tool === "bash") return { code: typeof command === "string" && command.trim() !== "" ? command : entry.command, shell: true };
  return { code: entry.command, shell: false };
}

/** Every argument of a call that is not a shell command, for the reader who wants more than the preview. */
export function argumentsText(entry: GatedActionEntry, record: GatedAction | undefined): string | undefined {
  if (entry.tool === "bash" || record === undefined || Object.keys(record.args).length === 0) return undefined;
  return JSON.stringify(record.args, undefined, 2);
}

/** Whether the card waits on the reader. Before the first read the entry is trusted; after it, only the record counts. */
export function gatedIsWaiting(record: GatedAction | undefined, read: boolean): boolean {
  return record === undefined ? !read : record.state.kind === "waiting";
}

/**
 * The waiting calls one choice may approve together: two or more, each with a record that says it still waits. An
 * unread or failed read approves nothing in a batch, since a card may already be decided elsewhere.
 */
export function batchApprovable(entries: readonly Pick<GatedActionEntry, "id">[], records: readonly GatedAction[] | undefined, readFailed: boolean): string[] {
  if (records === undefined || readFailed) return [];
  const ids = entries.map((entry) => entry.id).filter((id) => records.some((record) => record.id === id && record.state.kind === "waiting"));
  return ids.length >= 2 ? ids : [];
}

/** Whether a gated action has its final outcome: it ran, failed, or was refused. Nothing changes it after that. */
export function isSettled(record: GatedAction): boolean {
  return record.state.kind === "ran" || record.state.kind === "failed" || record.state.kind === "refused";
}

/** The first line of a text, cut to a length that fits one line of a card. */
export function firstLine(text: string, length = 160): string {
  const line = text.trim().split("\n").find((candidate) => candidate.trim() !== "")?.trim() ?? "";
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

/** Whether a text says more than its first line. */
export function saysMore(text: string): boolean {
  return text.trim() !== firstLine(text);
}

/**
 * Text from a tool's JSON result: the text of its content parts when it has them (a result that holds only an image or
 * details is shown as JSON), the text itself for a string, and JSON for anything else.
 */
export function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";
  const content: unknown = typeof result === "object" && "content" in result ? result.content : undefined;
  if (Array.isArray(content)) {
    const texts = content.flatMap((part: unknown) => typeof part === "object" && part !== null && "type" in part && part.type === "text"
      && "text" in part && typeof part.text === "string" ? [part.text] : []);
    if (texts.join("").trim() !== "") return texts.join("\n");
  }
  return JSON.stringify(result, undefined, 2);
}

/** A failed run's error. A tool that reported an error saves its whole result as JSON; its text is what the reader needs. */
export function errorText(error: string): string {
  try {
    const parsed: unknown = JSON.parse(error);
    if (typeof parsed === "object" && parsed !== null && "content" in parsed) return resultText(parsed);
  } catch { /* Plain text, as most errors are. */ }
  return error;
}

const UNKNOWN_OUTCOME = /^Unknown outcome:\s*/u;
/**
 * An approved call whose run was interrupted, such as by a restart, after Forgerie committed to run it: it may or may
 * not have run, and it is never run again. Undefined for any other failure.
 */
export function unknownOutcome(record: GatedAction | undefined): { lead: string; rest: string } | undefined {
  if (record?.state.kind !== "failed" || !UNKNOWN_OUTCOME.test(record.state.error)) return undefined;
  const text = record.state.error.replace(UNKNOWN_OUTCOME, "").trim();
  const [lead = "", ...rest] = text.split(/(?<=\.)\s+/u);
  return { lead: lead.replace(/\.$/u, ""), rest: rest.join(" ") };
}

/** What became of a gated action, for its closed card. */
export function gatedOutcome(record: GatedAction | undefined): string {
  switch (record?.state.kind) {
    case undefined: return "This action is no longer in the session's records.";
    case "waiting": return "Waiting for a decision.";
    case "approved": return "Approved — running…";
    case "refused": return "Refused";
    case "ran": return "Approved — ran";
    case "failed": {
      const unknown = unknownOutcome(record);
      if (unknown !== undefined) return unknown.lead === "" ? "Approved — outcome unknown" : `Approved — outcome unknown: ${unknown.lead}`;
      const line = firstLine(errorText(record.state.error));
      return line === "" ? "Approved — failed" : `Approved — failed: ${line}`;
    }
  }
}

/** Newest first, as the server lists them; two at the same moment by id, descending. Never changes its input. */
export function sortGated(records: readonly GatedAction[]): GatedAction[] {
  return [...records].sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id));
}

/** Which action is on its way for which record. */
export type GatedChoice = "approve" | "refuse";
