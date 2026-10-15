// The one file that knows the trigger routes (src/shared/triggers.ts holds the
// wire types). Everything else in this client reads the types below. The app's
// main chunk imports this module, so it imports shared types only.
import type {
  Trigger, TriggerCreate, TriggerListResponse, TriggerRunRequest, TriggerRunResponse, TriggerTargets, TriggerUpdate, TriggerWorkflowsResponse,
} from "@shared/triggers";
import type {
  TriggerFileDocument, TriggerFileSaveRequest, TriggerFileState, TriggerFileVersion, TriggerFileVersionsResponse, TriggerFileVersionText,
} from "@shared/triggerFiles";
import type { Fetch } from "../newSession";

/**
 * A trigger as the server returns it once schedules live in workflow files: `file` says which file holds its settings
 * and whether the file can be read. A trigger without `file` predates the file model and keeps the settings form.
 */
export type FileTrigger = Trigger & { file?: TriggerFileState | undefined };
/** The answer to a file save: the trigger as it now runs, and the file as saved. */
export interface TriggerFileSaved { trigger: FileTrigger; document: TriggerFileDocument }

/**
 * A non-success answer from a trigger route or its proxy. This alone does not
 * prove the request was refused: a proxy can lose the answer after admission.
 * `status` is the HTTP status. `field` names the request field at fault, as a
 * dotted path such as `schedule.at`, when the server knows it. `line` is the
 * 1-based line of a workflow file that would not run, when the server knows it.
 */
export class TriggerRefusal extends Error {
  constructor(message: string, readonly status: number, readonly field?: string, readonly line?: number) { super(message); }
}

/**
 * Run now rejects validation (400) and unknown triggers (404) before durableTriggers.run writes its receipt and
 * creates the task. The run path has no 409 refusal. Every other status, including proxy and store failures, is
 * ambiguous. This classifies this attempt only: it says nothing about admission by an earlier attempt.
 */
export function runRefusedBeforeAdmission(error: unknown): boolean {
  return error instanceof TriggerRefusal && (error.status === 400 || error.status === 404);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function looksLikeTargets(value: unknown): value is TriggerTargets {
  if (!isRecord(value)) return false;
  return value["kind"] === "all" || (value["kind"] === "projects" && Array.isArray(value["cwds"]) && value["cwds"].every((cwd) => typeof cwd === "string"));
}
/** Enough of a trigger for every part of the screen to read it. A malformed one drops out, not the list. */
function looksLikeTrigger(value: unknown): value is Trigger {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["name"] !== "string" || !Array.isArray(value["history"])) return false;
  const { schedule, action, state } = value;
  return isRecord(schedule) && typeof schedule["at"] === "string" && typeof schedule["timezone"] === "string"
    && isRecord(action) && looksLikeTargets(action["targets"]) && typeof action["workflow"] === "string"
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
function readTrigger(value: unknown): FileTrigger {
  if (!looksLikeTrigger(value)) throw new Error("Forgerie sent a trigger this app cannot read.");
  return value;
}
function readDocument(value: unknown): TriggerFileDocument {
  if (!isRecord(value) || typeof value["path"] !== "string" || typeof value["text"] !== "string" || typeof value["sha256"] !== "string"
    || typeof value["body"] !== "string" || !("schedule" in value) || !("definition" in value)) throw new Error("Forgerie sent a workflow file this app cannot read.");
  return value as unknown as TriggerFileDocument;
}
function readSaved(value: unknown): TriggerFileSaved {
  if (!isRecord(value)) throw new Error("Forgerie sent a save answer this app cannot read.");
  return { trigger: readTrigger(value["trigger"]), document: readDocument(value["document"]) };
}
const looksLikeVersion = (value: unknown): value is TriggerFileVersion => isRecord(value) && typeof value["id"] === "string"
  && typeof value["savedAt"] === "number" && typeof value["sha256"] === "string"
  && (value["source"] === "forgerie" || value["source"] === "outside" || value["source"] === "migration");
/** Newest first, as the server sends them. A malformed entry drops out, not the list. */
function readVersions(value: unknown): TriggerFileVersionsResponse {
  if (!isRecord(value) || !Array.isArray(value["versions"])) throw new Error("Forgerie sent a version list this app cannot read.");
  return { versions: value["versions"].filter(looksLikeVersion) };
}
function readVersion(value: unknown): TriggerFileVersionText {
  if (!isRecord(value) || !looksLikeVersion(value) || typeof (value as Record<string, unknown>)["text"] !== "string") throw new Error("Forgerie sent a version this app cannot read.");
  return value as TriggerFileVersionText;
}
/**
 * The 202 answer to Run now. Its `requestId` is the ID the run's history entry carries, in a form the browser cannot
 * build, so an answer without it cannot be followed. The same browser request ID sent again starts nothing new and
 * returns the same answer, so refusing an unreadable one is safe.
 */
function readRun(value: unknown): TriggerRunResponse {
  if (!isRecord(value) || typeof value["requestId"] !== "string" || !value["requestId"]) throw new Error("Forgerie sent a run answer this app cannot read.");
  return { requestId: value["requestId"] };
}
function readWorkflows(value: unknown): TriggerWorkflowsResponse {
  if (!isRecord(value) || !Array.isArray(value["workflows"])) throw new Error("Forgerie sent a workflow list this app cannot read.");
  const workflows = value["workflows"].filter((item): item is TriggerWorkflowsResponse["workflows"][number] => isRecord(item)
    && typeof item["name"] === "string" && (item["kind"] === "prose" || item["kind"] === "script") && isRecord(item["inputs"]));
  const diagnostics = Array.isArray(value["diagnostics"]) ? value["diagnostics"].filter((item): item is TriggerWorkflowsResponse["diagnostics"][number] =>
    isRecord(item) && typeof item["name"] === "string" && typeof item["path"] === "string" && typeof item["error"] === "string") : [];
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
      const line = isRecord(body) && typeof body["line"] === "number" && Number.isInteger(body["line"]) && body["line"] >= 1 ? body["line"] : undefined;
      throw new TriggerRefusal(error, response.status, field, line);
    }
    return read(await response.json());
  }
  const send = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({ method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const at = (id: string) => `/api/triggers/${encodeURIComponent(id)}`;
  return {
    list: (signal?: AbortSignal) => call("/api/triggers", readList, signal ? { signal } : {}),
    get: (id: string, signal?: AbortSignal) => call(at(id), readTrigger, signal ? { signal } : {}),
    /**
     * The prose workflows every target project can run with the same inputs, without opening a session. The
     * diagnostics say why each other name was left out. All projects reads the projects registered now.
     */
    commonWorkflows: (targets: TriggerTargets, signal?: AbortSignal) => call("/api/triggers/workflows/common", readWorkflows, send("POST", targets, signal)),
    /** The server picks the ID from the name. */
    create: (body: TriggerCreate) => call("/api/triggers", readTrigger, send("POST", body)),
    /** Refused with 409 when `baseRevision` is no longer the stored revision. */
    update: (id: string, body: TriggerUpdate) => call(at(id), readTrigger, send("PATCH", body)),
    pause: (id: string) => call(`${at(id)}/pause`, readTrigger, send("POST", {})),
    resume: (id: string) => call(`${at(id)}/resume`, readTrigger, send("POST", {})),
    acknowledge: (id: string) => call(`${at(id)}/acknowledge`, readTrigger, send("POST", {})),
    /**
     * Start one fire now, in every target project, or only in `cwd`. The same `requestId` starts nothing new, so a
     * request whose answer was lost can be sent again with it; the first accepted request keeps its `cwd`.
     */
    run: (id: string, requestId: string, cwd?: string) => call(`${at(id)}/run`, readRun,
      send("POST", { requestId, ...(cwd ? { cwd } : {}) } satisfies TriggerRunRequest)),
    remove: (id: string) => call(at(id), () => ({ ok: true as const }), { method: "DELETE" }),
    /** The workflow file that holds the trigger's settings, and what the server read from it. */
    file: (id: string, signal?: AbortSignal) => call(`${at(id)}/file`, readDocument, signal ? { signal } : {}),
    /**
     * Write the whole file. With `schedule`, the server writes that block into the file first. Refused with 400 (and
     * `line`) for a file that would not run, and with 409 when `baseSha256` is no longer the file's hash.
     */
    saveFile: (id: string, body: TriggerFileSaveRequest) => call(`${at(id)}/file`, readSaved, send("PUT", body)),
    /** The copies of the file Forgerie kept, newest first. */
    versions: (id: string, signal?: AbortSignal) => call(`${at(id)}/versions`, readVersions, signal ? { signal } : {}),
    version: (id: string, versionId: string, signal?: AbortSignal) =>
      call(`${at(id)}/versions/${encodeURIComponent(versionId)}`, readVersion, signal ? { signal } : {}),
  };
}
export type TriggersApi = ReturnType<typeof createTriggersApi>;
