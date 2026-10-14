// An in-memory trigger store behind the same interface as the HTTP client. Tests and the capture
// page hand it to the binding in the client's place: no request leaves the page, and nothing is intercepted.
import type { Trigger, TriggerCreate } from "@shared/triggers";
import { TriggerRefusal, type TriggersApi } from "../triggersApi";
import { commonWorkflows, HOST_ZONE, serverRunId } from "./triggers";
export { serverRunId };
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
  /** The next call of this name waits until `release` is called, as a slow server would. */
  hold: (name: keyof TriggersApi) => { release: () => void };
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
    failNext: (name, error) => { failures.set(name, error); },
  };
}

/** Projects and models from fixtures. */
export const memoryDirectory: TriggerDirectory = {
  projects: async () => projects,
  models: async () => ({ models }),
};
