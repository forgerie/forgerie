// The one file that knows the backlog suggestion wire contract (the server's TypeBox schema lands in
// src/shared on the build branch). Everything else in this client reads the types below. One malformed
// record drops out of a list, never the whole list; an unknown state kind drops that record.
import { z } from "zod";
import type { Fetch } from "../../newSession";

const text = z.string().min(1);
/** Only https links are drawn. Anything else reads as no link. */
const webLink = z.string().regex(/^https:\/\//u).optional().catch(undefined);

/** What the agent's `suggest_backlog` call returned, as its tool result's `details`. */
export const SUGGEST_BACKLOG_TOOL = "suggest_backlog";

export const suggestionDestinationSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("markdown"), path: text }),
  z.object({ provider: z.literal("github"), repo: text, label: z.string().catch("agent-filed") }),
]);
export type SuggestionDestination = z.infer<typeof suggestionDestinationSchema>;

/** A model choice for the background session. `modelSpec` is `provider/id`. Absent fields fall back. */
export const suggestionModelSchema = z.object({
  modelSpec: z.string().optional().catch(undefined),
  thinkingLevel: z.string().optional().catch(undefined),
});
export type SuggestionModel = z.infer<typeof suggestionModelSchema>;

const where = { provider: z.string().catch("markdown"), path: z.string().optional().catch(undefined),
  number: z.number().int().positive().optional().catch(undefined), url: webLink, at: z.string().catch(""),
  /** The item is filed, but the chat's history could not record it (such as an archived chat). Nothing to retry. */
  decisionLogWarning: z.string().optional().catch(undefined) };
const matchSchema = z.object({ number: z.number().int().positive().optional().catch(undefined), path: z.string().optional().catch(undefined),
  title: z.string(), state: z.string().catch("open"), url: webLink });

export const suggestionStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({ kind: z.literal("filing"), action: z.enum(["file", "file-and-act"]).catch("file") }),
  z.object({ kind: z.literal("filed"), ...where,
    /** File and act filed the item, then the background session did not start. */
    launchError: z.object({ message: z.string(), retryable: z.boolean().catch(false) }).optional().catch(undefined) }),
  z.object({ kind: z.literal("started"), ...where, sessionId: text, claimId: z.string().catch(""),
    modelSpec: z.string().optional().catch(undefined), thinkingLevel: z.string().optional().catch(undefined) }),
  z.object({ kind: z.literal("duplicate"), matches: z.array(matchSchema).catch([]) }),
  z.object({ kind: z.literal("failed"), message: z.string(), retryable: z.boolean().catch(false),
    /** The action that failed, so Retry repeats it. A server older than this field sends none. */
    action: z.enum(["file", "file-and-act"]).optional().catch(undefined) }),
  z.object({ kind: z.literal("dismissed"), at: z.string().catch("") }),
]);
export type SuggestionState = z.infer<typeof suggestionStateSchema>;

export const suggestionSchema = z.object({
  id: text, sessionId: text, projectId: z.string().catch(""), sessionTitle: z.string().optional().catch(undefined),
  title: z.string(), body: z.string().catch(""),
  context: z.object({ why: z.string().catch(""), files: z.array(z.string()).catch([]), decisions: z.array(z.string()).catch([]) })
    .catch({ why: "", files: [], decisions: [] }),
  destination: suggestionDestinationSchema,
  azureReadOnlyNote: z.boolean().optional().catch(undefined),
  defaultModel: suggestionModelSchema.catch({}),
  createdAt: z.string().catch(""),
  revision: z.number().catch(0),
  state: suggestionStateSchema,
});
export type Suggestion = z.infer<typeof suggestionSchema>;

const readable = <T>(schema: z.ZodType<T>) => z.array(z.unknown()).transform((values) => values.flatMap((value) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? [parsed.data] : [];
}));
export const suggestionListSchema = z.object({ suggestions: readable(suggestionSchema) });

/** A `suggest_backlog` result's details: the record to read, and where it goes. */
export const suggestionRefSchema = z.object({ suggestionId: text, destination: suggestionDestinationSchema.optional().catch(undefined) });
export type SuggestionRef = z.infer<typeof suggestionRefSchema>;
/** The record a finished `suggest_backlog` call made, or nothing for any other call or an unreadable result. */
export function suggestionRefOf({ toolName, details }: { toolName: string; details: unknown }): SuggestionRef | undefined {
  if (toolName !== SUGGEST_BACKLOG_TOOL) return undefined;
  return suggestionRefSchema.safeParse(details).data;
}

const errorSchema = z.object({ kind: z.string().catch("unavailable"), error: z.string() });
/** The server refused: `kind` from its body, `status` from HTTP. A 409 means the record moved on. */
export class SuggestionRefusal extends Error {
  constructor(message: string, readonly kind: string, readonly status: number) { super(message); }
}

/** What File and File and act may send. The server keeps the agent's words when title and body are absent. */
export interface FileRequest {
  title?: string | undefined; body?: string | undefined;
  /** The matches the reader saw and chose to file past. */
  notDuplicateOf?: readonly number[] | undefined;
}
export interface ActRequest extends FileRequest { modelSpec?: string | undefined; thinkingLevel?: string | undefined }

/** The reads and writes of backlog suggestions. Nothing here retries. */
export function createSuggestionsApi(fetchFn: Fetch, newId: () => string = () => crypto.randomUUID()) {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, init);
    if (!response.ok) {
      const body = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw body.success ? new SuggestionRefusal(body.data.error, body.data.kind, response.status)
        : new SuggestionRefusal(`Forgerie answered ${String(response.status)}.`, "unavailable", response.status);
    }
    return schema.parse(await response.json());
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const route = (id: string, verb: string) => `/api/backlog/suggestions/${encodeURIComponent(id)}/${verb}`;
  const fields = (request: ActRequest) => Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
  return {
    /** Newest first. Without a session, every chat's. */
    list: (query: { sessionId?: string | undefined; state?: string | undefined }, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (query.sessionId !== undefined) params.set("sessionId", query.sessionId);
      if (query.state !== undefined) params.set("state", query.state);
      return call(`/api/backlog/suggestions${params.size ? `?${params.toString()}` : ""}`, suggestionListSchema, signal ? { signal } : {})
        .then((value) => value.suggestions);
    },
    file: (id: string, request: FileRequest) => call(route(id, "file"), suggestionSchema, post({ requestId: newId(), ...fields(request) })),
    fileAndAct: (id: string, request: ActRequest) => call(route(id, "file-and-act"), suggestionSchema, post({ requestId: newId(), ...fields(request) })),
    dismiss: (id: string) => call(route(id, "dismiss"), suggestionSchema, post({})),
    restore: (id: string) => call(route(id, "restore"), suggestionSchema, post({})),
  };
}
export type SuggestionsApi = ReturnType<typeof createSuggestionsApi>;
