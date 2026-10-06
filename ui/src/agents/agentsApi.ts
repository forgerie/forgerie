import { z } from "zod";

const agentSummarySchema = z.object({
  scope: z.enum(["user", "builtin"]),
  file: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
  thinking: z.string().optional(),
  advertise: z.boolean(),
  disabled: z.boolean(),
  mtimeMs: z.number(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentScope = AgentSummary["scope"];
const listSchema = z.object({ home: z.string(), userDir: z.string(), agents: z.array(agentSummarySchema) });
export type AgentList = z.infer<typeof listSchema>;
const fileSchema = z.object({ scope: z.enum(["user", "builtin"]), file: z.string(), text: z.string(), mtimeMs: z.number() });
export type AgentFileText = z.infer<typeof fileSchema>;

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
  write: (file: string, text: string, baseMtimeMs: number | null) => call(path("user", file), fileSchema, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, baseMtimeMs }),
  }),
  remove: (file: string, baseMtimeMs: number) => call(`${path("user", file)}?baseMtimeMs=${String(baseMtimeMs)}`, z.object({ deleted: z.string() }), { method: "DELETE" }),
};
