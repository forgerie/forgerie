// Gated actions: tool calls Forgerie holds until the reader approves them (docs/adr/0003).
// The server side is the Durable `beforeTool` hook and the doc `forgerie.gated-actions` per conversation; the routes are
// GET /api/sessions/:id/gated-actions?cwd= and POST …/gated-actions/:gid/approve|refuse { cwd }.
// These schemas mirror the agreed slice 2 interface. Once src/shared/ carries the wire types, they mirror those field for
// field, with a parity test like decisions/decisionsParity.test.ts.
import { z } from "zod";
import type { PiMessage } from "../contracts";

/** The transcript entry the hook writes when it blocks a call. */
export const GATED_ACTION_TYPE = "forgerie.gated-action";

export const GATED_CATEGORIES = ["force-push", "destroy-local", "delete-remote", "github-merge-close", "publish", "messages"] as const;
export const gatedCategorySchema = z.enum(GATED_CATEGORIES);
export type GatedCategory = z.infer<typeof gatedCategorySchema>;

export const gatedActionStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("waiting") }),
  /** Approved and running now. */
  z.strictObject({ kind: z.literal("approved") }),
  z.strictObject({ kind: z.literal("refused"), at: z.number() }),
  z.strictObject({ kind: z.literal("ran"), result: z.string(), at: z.number() }),
  z.strictObject({ kind: z.literal("failed"), error: z.string(), at: z.number() }),
]);
export const gatedActionSchema = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  /** Who asked: a child agent's name, or "parent". */
  by: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  category: gatedCategorySchema,
  /** What the call does, in plain words. */
  description: z.string(),
  requestedAt: z.number(),
  state: gatedActionStateSchema,
});
export const gatedActionsSchema = z.array(gatedActionSchema);
export type GatedAction = z.infer<typeof gatedActionSchema>;

/** The entry's details: enough to draw the card before the session's records are read. */
const gatedEntrySchema = z.object({
  id: z.string().min(1),
  by: z.string(),
  tool: z.string(),
  category: gatedCategorySchema,
  description: z.string(),
  /** The exact command, or a short form of the arguments. */
  preview: z.string(),
});
export type GatedEntry = z.infer<typeof gatedEntrySchema>;

/** The gated action a transcript message records, if it is one. An entry this app cannot read is not one. */
export function gatedEntryOf(message: PiMessage): GatedEntry | undefined {
  if (message.role !== "custom" || message.customType !== GATED_ACTION_TYPE) return undefined;
  const details = gatedEntrySchema.safeParse(message.details);
  return details.success ? details.data : undefined;
}

/**
 * Each category's name. src/shared/autonomyPolicy.ts will own these words; until the UI imports them, they are copied
 * here, and the parity test will hold them equal.
 */
export const CATEGORY_LABEL: Record<GatedCategory, string> = {
  "force-push": "Force-push",
  "destroy-local": "Discard local work",
  "delete-remote": "Remote delete",
  "github-merge-close": "GitHub merge or close",
  publish: "Publish",
  messages: "Message in your name",
};

/** What cannot be undone, by category: the reason the call waits for the reader. One sentence each. */
const CONSEQUENCE: Record<GatedCategory, string> = {
  "force-push": "It replaces the branch on the remote, and commits that exist only there are lost.",
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

/** Who asked, in the reader's words. */
export function askerOf(by: string): string {
  return by === "parent" ? "the parent" : by;
}

/** The fact at the end of the card's title line: the category, and who asked. */
export function gatedMeta(entry: Pick<GatedEntry, "by" | "category">): string {
  return `${CATEGORY_LABEL[entry.category]}, asked by ${askerOf(entry.by)}`;
}

/**
 * The call the card shows: for a shell call, the exact command from the record once it is read; otherwise the entry's
 * preview. `shell` says whether to draw it as a shell command.
 */
export function shownCall(entry: GatedEntry, record: GatedAction | undefined): { code: string; shell: boolean } {
  const command = record?.args["command"];
  if (entry.tool === "bash") return { code: typeof command === "string" && command.trim() !== "" ? command : entry.preview, shell: true };
  return { code: entry.preview, shell: false };
}

/** Every argument of a call that is not a shell command, for the reader who wants more than the preview. */
export function argumentsText(entry: GatedEntry, record: GatedAction | undefined): string | undefined {
  if (entry.tool === "bash" || record === undefined || Object.keys(record.args).length === 0) return undefined;
  return JSON.stringify(record.args, undefined, 2);
}

/** Whether the card waits on the reader. Before the first read the entry is trusted; after it, only the record counts. */
export function gatedIsWaiting(record: GatedAction | undefined, read: boolean): boolean {
  return record === undefined ? !read : record.state.kind === "waiting";
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

/** What became of a gated action, for its closed card. */
export function gatedOutcome(record: GatedAction | undefined): string {
  switch (record?.state.kind) {
    case undefined: return "This action is no longer in the session's records.";
    case "waiting": return "Waiting for a decision.";
    case "approved": return "Approved — running…";
    case "refused": return "Refused";
    case "ran": return "Approved — ran";
    case "failed": {
      const line = firstLine(record.state.error);
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
