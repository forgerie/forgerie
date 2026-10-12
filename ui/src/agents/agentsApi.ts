import { z } from "zod";

const agentSummarySchema = z.object({
  scope: z.enum(["home", "user", "builtin"]),
  file: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
  thinking: z.string().optional(),
  advertise: z.boolean(),
  disabled: z.boolean(),
  broken: z.string().optional(),
  mtimeMs: z.number(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentScope = AgentSummary["scope"];
/** The scopes a person can write: `home` is `~/.agents`, `user` is the profile's `agents`. */
export type WritableAgentScope = Exclude<AgentScope, "builtin">;
const listSchema = z.object({ home: z.string(), homeDir: z.string().optional(), userDir: z.string(), agents: z.array(agentSummarySchema) });
export type AgentList = z.infer<typeof listSchema>;
const fileSchema = z.object({ scope: z.enum(["home", "user", "builtin"]), file: z.string(), text: z.string(), mtimeMs: z.number() });

/** The group of files in `~/.agents`, which every Pi profile and Pi in the terminal read. */
export const SHARED_AGENTS = { title: "Shared with every profile", where: "Pi in the terminal reads these too." } as const;

/**
 * What replaces an agent, as sessions resolve names: `~/.agents` before the profile, both before built-in agents.
 * Undefined when nothing does.
 */
export function replacedBy(agent: AgentSummary, agents: readonly AgentSummary[]): string | undefined {
  if (agent.scope === "home") return undefined;
  const named = (scope: AgentScope) => agents.some((other) => other.scope === scope && other.name === agent.name);
  if (named("home")) return "Replaced by your shared agent";
  return agent.scope === "builtin" && named("user") ? "Replaced by yours" : undefined;
}

/** A write the server refused because the file moved on. Reloading is the way out. */
export class AgentConflict extends Error {}

const path = (scope: AgentScope, file: string) => `/aui/agents/${scope}/${file.split("/").map(encodeURIComponent).join("/")}`;
async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof value === "object" && value && "error" in value && typeof value.error === "string" ? value.error : `The agents server answered ${String(response.status)}.`;
    throw response.status === 409 ? new AgentConflict(message) : new Error(message);
  }
  return schema.parse(value);
}

export const agentsApi = {
  list: (signal?: AbortSignal) => call("/aui/agents", listSchema, signal ? { signal } : {}),
  read: (scope: AgentScope, file: string, signal?: AbortSignal) => call(path(scope, file), fileSchema, signal ? { signal } : {}),
  /** `baseMtimeMs: null` creates the file and fails if it exists. */
  write: (scope: WritableAgentScope, file: string, text: string, baseMtimeMs: number | null) => call(path(scope, file), fileSchema, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, baseMtimeMs }),
  }),
  remove: (scope: WritableAgentScope, file: string, baseMtimeMs: number) => call(`${path(scope, file)}?baseMtimeMs=${String(baseMtimeMs)}`, z.object({ deleted: z.string() }), { method: "DELETE" }),
};
