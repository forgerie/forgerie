// The one file that knows the trigger routes (src/shared/triggers.ts holds the
// wire types). Everything else in this client reads the types below. The app's
// main chunk imports this module, so it imports shared types only.
import type {
  Trigger, TriggerCreate, TriggerListResponse, TriggerRunResponse, TriggerUpdate, TriggerWorkflowsResponse,
} from "@shared/triggers";
import type { Fetch } from "../newSession";

/**
 * The server refused a trigger request. `status` is the HTTP status: 400 a bad
 * request, 404 an unknown trigger, 409 a conflict (another change came first),
 * 503 the trigger store is off. `field` names the request field at fault, as a
 * dotted path such as `schedule.at`, when the server knows it.
 */
export class TriggerRefusal extends Error {
  constructor(message: string, readonly status: number, readonly field?: string) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Enough of a trigger for every part of the screen to read it. A malformed one drops out, not the list. */
function looksLikeTrigger(value: unknown): value is Trigger {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["name"] !== "string" || !Array.isArray(value["history"])) return false;
  const { schedule, action, state } = value;
  return isRecord(schedule) && typeof schedule["at"] === "string" && typeof schedule["timezone"] === "string"
    && isRecord(action) && typeof action["cwd"] === "string" && typeof action["workflow"] === "string"
    && isRecord(state) && (state["kind"] === "active" || state["kind"] === "paused") && typeof value["revision"] === "number";
}
function readList(value: unknown): TriggerListResponse {
  if (!isRecord(value) || !Array.isArray(value["triggers"])) throw new Error("Forgerie sent a trigger list this app cannot read.");
  const triggers = value["triggers"].filter(looksLikeTrigger);
  const timezone = typeof value["timezone"] === "string" ? value["timezone"] : "UTC";
  const timezones = Array.isArray(value["timezones"]) ? value["timezones"].filter((zone): zone is string => typeof zone === "string") : [timezone];
  const attentionCount = typeof value["attentionCount"] === "number" ? value["attentionCount"] : triggers.filter((trigger) => trigger.attention !== null).length;
  return { triggers, attentionCount, timezone, timezones };
}
function readTrigger(value: unknown): Trigger {
  if (!looksLikeTrigger(value)) throw new Error("Forgerie sent a trigger this app cannot read.");
  return value;
}
function readWorkflows(value: unknown): TriggerWorkflowsResponse {
  if (!isRecord(value) || !Array.isArray(value["workflows"])) throw new Error("Forgerie sent a workflow list this app cannot read.");
  const workflows = value["workflows"].filter((item): item is TriggerWorkflowsResponse["workflows"][number] => isRecord(item)
    && typeof item["name"] === "string" && (item["kind"] === "prose" || item["kind"] === "script") && isRecord(item["inputs"]));
  const diagnostics = Array.isArray(value["diagnostics"]) ? value["diagnostics"].filter((item): item is TriggerWorkflowsResponse["diagnostics"][number] =>
    isRecord(item) && typeof item["name"] === "string" && typeof item["error"] === "string") : [];
  return { workflows, diagnostics };
}

/** The reads and writes of triggers. Nothing here retries on its own. */
export function createTriggersApi(fetchFn: Fetch) {
  async function call<T>(path: string, read: (value: unknown) => T, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, init);
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const error = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `Request failed: HTTP ${String(response.status)}`;
      const field = isRecord(body) && typeof body["field"] === "string" ? body["field"] : undefined;
      throw new TriggerRefusal(error, response.status, field);
    }
    return read(await response.json());
  }
  const send = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({ method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const at = (id: string) => `/api/triggers/${encodeURIComponent(id)}`;
  return {
    list: (signal?: AbortSignal) => call("/api/triggers", readList, signal ? { signal } : {}),
    get: (id: string, signal?: AbortSignal) => call(at(id), readTrigger, signal ? { signal } : {}),
    /** A project's saved workflows, without opening a session there. */
    workflows: (cwd: string, signal?: AbortSignal) => call(`/api/triggers/workflows?${new URLSearchParams({ cwd }).toString()}`, readWorkflows, signal ? { signal } : {}),
    /** The server picks the ID from the name. */
    create: (body: TriggerCreate) => call("/api/triggers", readTrigger, send("POST", body)),
    /** Refused with 409 when `baseRevision` is no longer the stored revision. */
    update: (id: string, body: TriggerUpdate) => call(at(id), readTrigger, send("PATCH", body)),
    pause: (id: string) => call(`${at(id)}/pause`, readTrigger, send("POST", {})),
    resume: (id: string) => call(`${at(id)}/resume`, readTrigger, send("POST", {})),
    acknowledge: (id: string) => call(`${at(id)}/acknowledge`, readTrigger, send("POST", {})),
    /**
     * Start one run now. The same `requestId` starts nothing new, so a request
     * whose answer was lost can be sent again with it.
     */
    run: (id: string, requestId: string) => call(`${at(id)}/run`, (value): TriggerRunResponse => ({
      requestId: isRecord(value) && typeof value["requestId"] === "string" ? value["requestId"] : requestId,
    }), send("POST", { requestId })),
    remove: (id: string) => call(at(id), () => ({ ok: true as const }), { method: "DELETE" }),
  };
}
export type TriggersApi = ReturnType<typeof createTriggersApi>;
