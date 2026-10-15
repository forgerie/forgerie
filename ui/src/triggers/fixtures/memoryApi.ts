// An in-memory trigger store behind the same interface as the HTTP client. Tests and the capture
// page hand it to the binding in the client's place: no request leaves the page, and nothing is intercepted.
import type { Trigger, TriggerCreate } from "@shared/triggers";
import type { TriggerFileDocument, TriggerFileVersionText, WorkflowScheduleBlock } from "@shared/triggerFiles";
import { TriggerRefusal, type FileTrigger, type TriggersApi } from "../triggersApi";
import { fakeSha } from "./triggerFiles";
import { commonWorkflows, HOST_ZONE, serverRunId } from "./triggers";
export { serverRunId };
import type { TriggerDirectory } from "../Triggers.binding";
import { models, projects } from "./triggers";

const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];

/** A workflow file the store holds for a trigger: the file as read (absent: the file is gone) and its kept versions. */
export interface MemoryFile { document?: TriggerFileDocument | undefined; versions?: TriggerFileVersionText[] | undefined }

/** A file line that would not run: an `at:` that is not a quoted or bare HH:mm time. The fixture server's one rule. */
const AT = /^\s*at:\s*(.*)$/u;
const TIME = /^"?([01][0-9]|2[0-3]):[0-5][0-9]"?$/u;
function refusal(text: string): TriggerRefusal | undefined {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => { const value = AT.exec(line)?.[1]?.trim(); return value !== undefined && !TIME.test(value); });
  if (index < 0) return undefined;
  const said = AT.exec(lines[index] ?? "")?.[1]?.trim() ?? "";
  return new TriggerRefusal(`\`at\` must be a time such as "01:00". The file says "${said}".`, 400, "schedule.at", index + 1);
}
/** The trigger as a saved block makes it run: its time, days, zone, and pause. */
function applyBlock(trigger: FileTrigger, block: WorkflowScheduleBlock, now: number): FileTrigger {
  const timezone = block.timezone ?? trigger.schedule.timezone;
  const schedule = block.days && block.days.length < 7 ? { kind: "weekly" as const, at: block.at, timezone, on: block.days } : { kind: "daily" as const, at: block.at, timezone };
  return { ...trigger, schedule, state: block.paused ? { kind: "paused", pausedAt: now } : trigger.state.kind === "paused" ? { kind: "active", nextFireAt: now + 9 * 3_600_000 } : trigger.state };
}

export interface MemoryStore {
  api: TriggersApi;
  calls: unknown[][];
  /** Replace what the store holds, as another window or an agent would. */
  set: (triggers: Trigger[]) => void;
  /** The next call of this name fails with this error once. */
  failNext: (name: keyof TriggersApi, error: Error) => void;
  /** The next call of this name waits until `release` is called, as a slow server would. */
  hold: (name: keyof TriggersApi) => { release: () => void };
  triggers: () => Trigger[];
  /** The file the store holds for a trigger now. */
  file: (id: string) => MemoryFile | undefined;
  /** Change a file as an edit outside Forgerie would. */
  setFile: (id: string, file: MemoryFile) => void;
}

export function memoryApi(initial: readonly Trigger[], options: { now: number; off?: string | undefined; files?: Record<string, MemoryFile> | undefined } = { now: 0 }): MemoryStore {
  let triggers = [...initial];
  const files = new Map(Object.entries(options.files ?? {}));
  const documentOf = (id: string) => {
    const document = files.get(id)?.document;
    if (!document) throw new TriggerRefusal("No workflow file has this trigger's name.", 404);
    return document;
  };
  const calls: unknown[][] = [];
  const failures = new Map<string, Error>();
  const check = (name: string) => {
    const failure = failures.get(name);
    if (failure) { failures.delete(name); throw failure; }
    if (options.off) throw new TriggerRefusal(options.off, 503);
  };
  const find = (id: string) => {
    const found = triggers.find((trigger) => trigger.id === id);
    if (!found) throw new TriggerRefusal("No trigger has this ID.", 404);
    return found;
  };
  const change = (id: string, edit: (trigger: Trigger) => Trigger) => {
    const next = edit(find(id));
    triggers = triggers.map((trigger) => trigger.id === id ? { ...next, revision: trigger.revision + 1 } : trigger);
    return find(id);
  };
  const inner: TriggersApi = {
    list: async () => {
      check("list"); calls.push(["list"]);
      return { triggers: triggers.map((trigger) => ({ ...trigger, history: trigger.history.slice(0, 7) })),
        attentionCount: triggers.filter((trigger) => trigger.attention !== null).length, timezone: HOST_ZONE, timezones: ZONES };
    },
    get: async (id) => { check("get"); calls.push(["get", id]); return find(id); },
    commonWorkflows: async (targets) => { check("commonWorkflows"); calls.push(["commonWorkflows", targets]); return commonWorkflows(targets); },
    create: async (body: TriggerCreate) => {
      check("create"); calls.push(["create", body]);
      const id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const created: Trigger = { id, name: body.name, schedule: body.schedule, action: body.action, missedGraceMinutes: body.missedGraceMinutes ?? 360,
        createdAt: options.now, createdBy: { kind: "user" }, revision: 1, generation: 1, state: { kind: "active", nextFireAt: options.now + 9 * 3_600_000 },
        attention: null, history: [] };
      triggers = [...triggers, created];
      return created;
    },
    update: async (id, body) => {
      check("update"); calls.push(["update", id, body]);
      if (find(id).revision !== body.baseRevision) throw new TriggerRefusal("Another change came first. Read the trigger again.", 409);
      const fields = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "baseRevision")) as Partial<Trigger>;
      return change(id, (trigger) => ({ ...trigger, ...fields }));
    },
    pause: async (id) => { check("pause"); calls.push(["pause", id]); return change(id, (trigger) => ({ ...trigger, state: { kind: "paused", pausedAt: options.now } })); },
    resume: async (id) => { check("resume"); calls.push(["resume", id]); return change(id, (trigger) => ({ ...trigger, state: { kind: "active", nextFireAt: options.now + 9 * 3_600_000 } })); },
    acknowledge: async (id) => { check("acknowledge"); calls.push(["acknowledge", id]); return change(id, (trigger) => ({ ...trigger, attention: null })); },
    run: async (id, requestId, cwd) => {
      check("run"); calls.push(cwd ? ["run", id, requestId, cwd] : ["run", id, requestId]); find(id); return { requestId: serverRunId(id, requestId) };
    },
    remove: async (id) => { check("remove"); calls.push(["remove", id]); find(id); triggers = triggers.filter((trigger) => trigger.id !== id); return { ok: true as const }; },
    file: async (id) => { check("file"); calls.push(["file", id]); return documentOf(id); },
    saveFile: async (id, body) => {
      check("saveFile"); calls.push(["saveFile", id, body]);
      const before = documentOf(id);
      if (before.sha256 !== body.baseSha256) throw new TriggerRefusal("The file changed since you read it. Read it again, then save.", 409);
      const refused = refusal(body.text);
      if (refused) throw refused;
      // The fixture keeps the block it is sent, without writing it into the text: a test reads the request, not YAML.
      const schedule = body.schedule ?? before.schedule;
      const document: TriggerFileDocument = { ...before, text: body.text, sha256: fakeSha(`${body.text}${JSON.stringify(schedule)}`), modifiedAt: options.now, schedule,
        body: body.text.replace(/^---\n[\s\S]*?\n---\n/u, "") };
      const kept = files.get(id)?.versions ?? [];
      files.set(id, { document, versions: [{ id: `v${String(kept.length + 1)}`, savedAt: options.now, source: "forgerie", sha256: document.sha256, text: body.text }, ...kept] });
      const trigger = change(id, (current) => {
        const next: FileTrigger = { ...current, file: { path: document.path, status: "ok", lastGoodAt: options.now } };
        return schedule ? applyBlock(next, schedule, options.now) : next;
      });
      return { trigger, document };
    },
    versions: async (id) => {
      check("versions"); calls.push(["versions", id]);
      return { versions: (files.get(id)?.versions ?? []).map((version) => ({ id: version.id, savedAt: version.savedAt, source: version.source, sha256: version.sha256 })) };
    },
    version: async (id, versionId) => {
      check("version"); calls.push(["version", id, versionId]);
      const found = files.get(id)?.versions?.find((version) => version.id === versionId);
      if (!found) throw new TriggerRefusal("Forgerie no longer keeps this version.", 404);
      return found;
    },
  };
  const holds = new Map<string, Promise<void>>();
  const api = Object.fromEntries(Object.entries(inner).map(([name, call]) => [name, async (...args: unknown[]) => {
    const held = holds.get(name);
    if (held) { holds.delete(name); await held; }
    return (call as (...values: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as TriggersApi;
  return {
    api, calls, triggers: () => triggers,
    hold: (name) => {
      let release = () => undefined as void;
      holds.set(name, new Promise<void>((resolve) => { release = resolve; }));
      return { release: () => release() };
    },
    set: (next) => { triggers = [...next]; },
    file: (id) => files.get(id),
    setFile: (id, file) => { files.set(id, file); },
    failNext: (name, error) => { failures.set(name, error); },
  };
}

/** Projects and models from fixtures. */
export const memoryDirectory: TriggerDirectory = {
  projects: async () => projects,
  models: async () => ({ models }),
};
