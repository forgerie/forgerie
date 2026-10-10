import { z } from "zod";
import { sessionSchema } from "./contracts";
import { sessionTreeSnapshotSchema } from "./sessionTree";

export const slashCommandSchema = z.object({
  name: z.string().min(1), description: z.string().optional(),
  source: z.enum(["builtin", "extension", "prompt", "skill"]),
});
export type SlashCommand = z.infer<typeof slashCommandSchema>;
export const commandCatalogSchema = z.array(slashCommandSchema);
export type CommandCatalog = { type: "loading" } | { type: "ready"; commands: SlashCommand[] }
  | { type: "failed"; message: string };
export const commandResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("done"), message: z.string().optional(), presentation: z.literal("toast").optional(), session: sessionSchema.optional(), promptDraft: z.string().optional() }),
  z.object({ type: z.literal("unsupported"), message: z.string() }),
  z.object({ type: z.literal("select"), requestId: z.string().min(1), title: z.string(),
    options: z.array(z.object({ value: z.string(), label: z.string(), description: z.string().optional() })) }),
  z.object({ type: z.literal("tree"), tree: sessionTreeSnapshotSchema }),
]);
export type CommandResult = z.infer<typeof commandResultSchema>;

/** Pi executes only leading slash text. Ordinary paths inside messages stay text. */
export function isCommand(text: string): boolean { return text.startsWith("/"); }

/**
 * The one line the slash palette may show for a command, if any.
 *
 * A skill's description is written for the model: Pi hands the agent that same
 * paragraph to decide when to load the skill. It is a page of prose, so it
 * never reaches the palette, and it never matches a search either — a row must
 * never appear for a reason the reader cannot see. Every other source declares
 * a line for a person, and the palette draws it.
 */
export function paletteDescription(command: SlashCommand): string | undefined {
  return command.source === "skill" ? undefined : command.description;
}

/** Autocomplete only the leading word, never paths or already-entered arguments. */
export function matchSlash(text: string, char: string, cursor: number) {
  if (!text.startsWith(char) || cursor < char.length) return null;
  const query = text.slice(char.length, cursor);
  if (/\s/u.test(query)) return null;
  return { query, offset: 0, endOffset: cursor };
}

// Pi expects plain slash text, not assistant-ui's :command[...] directive syntax.
export const piCommandFormatter = {
  serialize: (item: { label: string }) => item.label,
  parse: (text: string) => [{ kind: "text" as const, text }],
};
