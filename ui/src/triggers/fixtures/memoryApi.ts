// An in-memory trigger store behind the same interface as the HTTP client. Tests and the capture
// page hand it to the binding in the client's place: no request leaves the page, and nothing is intercepted.
import type { Trigger, TriggerCreate } from "@shared/triggers";
import { TriggerRefusal, type TriggersApi } from "../triggersApi";
import { HOST_ZONE, workflows as savedWorkflows } from "./triggers";
import type { TriggerDirectory } from "../Triggers.binding";
import { models, projects } from "./triggers";

const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];

export interface MemoryStore {
  api: TriggersApi;
  calls: unknown[][];
  /** Replace what the store holds, as another window or an agent would. */
  set: (triggers: Trigger[]) => void;
  /** The next call of this name fails with this error once. */
  failNext: (name: keyof TriggersApi, error: Error) => void;
  triggers: () => Trigger[];
}

export function memoryApi(initial: readonly Trigger[], options: { now: number; off?: string | undefined } = { now: 0 }): MemoryStore {
  let triggers = [...initial];
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
  const api: TriggersApi = {
    list: async () => {
      check("list"); calls.push(["list"]);
      return { triggers: triggers.map((trigger) => ({ ...trigger, history: trigger.history.slice(0, 7) })),
        attentionCount: triggers.filter((trigger) => trigger.attention !== null).length, timezone: HOST_ZONE, timezones: ZONES };
    },
    get: async (id) => { check("get"); calls.push(["get", id]); return find(id); },
    workflows: async (cwd) => { check("workflows"); calls.push(["workflows", cwd]); return { workflows: savedWorkflows, diagnostics: [] }; },
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
    run: async (id, requestId) => { check("run"); calls.push(["run", id, requestId]); find(id); return { requestId }; },
    remove: async (id) => { check("remove"); calls.push(["remove", id]); find(id); triggers = triggers.filter((trigger) => trigger.id !== id); return { ok: true as const }; },
  };
  return {
    api, calls, triggers: () => triggers,
    set: (next) => { triggers = [...next]; },
    failNext: (name, error) => { failures.set(name, error); },
  };
}

/** Folders and models from fixtures. */
export const memoryDirectory: TriggerDirectory = {
  projects: async () => projects,
  workspaces: async (projectId) => projects.filter((project) => project.id === projectId)
    .map((project) => ({ id: `${project.id}-main`, path: project.path, label: project.name, isMain: true })),
  models: async () => ({ models }),
};
