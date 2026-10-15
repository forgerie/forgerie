import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { TriggerFileSync } from "./triggerFileSync.js";
import { TriggerFiles } from "./triggerFiles.js";
import { TriggerService } from "./triggerService.js";
import { durableTriggers, type ProjectTriggerFireRequest } from "./durableTriggers.js";

let root: string;
let agent: string;
let cwd: string;
let projects: ProjectService;
let service: TriggerService | undefined;
let errors: unknown[];
let requests: ProjectTriggerFireRequest[];
const prose = '---\n# Preserve me\ndescription: Night\nworkflow: { version: 1, inputs: { scope: { type: string, default: ready } } }\n---\nReview.\n';
const scheduled = (block = 'at: "03:00", projects: [Repo]') => prose.replace("---\nReview.", `schedule: { ${block} }\n---\nReview.`);
const file = () => join(agent, "prompts", "night.md");
const quietWatch = () => ({ close: () => undefined });
const quietInterval = () => () => undefined;
async function open(extra: Partial<Pick<Parameters<typeof TriggerService.open>[0], "now" | "fileSync">> = {}) {
  service = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(agent), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    now: () => Date.parse("2026-10-13T00:00:00Z"), fire: (request) => { requests.push(request); return Promise.resolve({ sessionId: "session", cwd: request.action.cwd, runId: request.requestId }); },
    publish: () => undefined, onError: (error) => { errors.push(error); }, fileSync: { watch: quietWatch, interval: quietInterval }, ...extra });
  return service;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "trigger-file-sync-")); agent = join(root, "agent"); cwd = join(root, "repo");
  await mkdir(join(agent, "prompts"), { recursive: true }); await mkdir(cwd);
  projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: cwd, name: "Repo" });
  errors = []; requests = [];
});
afterEach(async () => { try { await service?.close(); } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); } });
it("scans at start and applies edits, pauses and re-arms through the durable core", async () => {
  await writeFile(file(), scheduled()); const triggers = await open();
  const initial = await triggers.get("night"); expect(initial).toMatchObject({ id: "night", file: { status: "ok" }, action: { targets: { cwds: [cwd] }, inputs: { scope: "ready" } } });
  await writeFile(file(), scheduled('at: "04:00", projects: [Repo], inputs: { scope: changed }, paused: true')); await triggers.syncFiles();
  const paused = await triggers.get("night"); expect(paused).toMatchObject({ state: { kind: "paused" }, schedule: { at: "04:00" }, action: { inputs: { scope: "changed" } } });
  await writeFile(file(), scheduled('at: "04:00", projects: [Repo]')); await triggers.syncFiles();
  const resumed = await triggers.get("night"); expect(resumed.state.kind).toBe("active"); expect(resumed.generation).toBeGreaterThan(initial.generation);
  await triggers.syncFiles(); expect((await triggers.get("night")).revision).toBe(resumed.revision); expect(errors).toEqual([]);
});
it.each(["file", "block"])("pauses a missing %s, retains history, and resumes when it returns", async (kind) => {
  await writeFile(file(), scheduled()); const triggers = await open(); await triggers.run("night", { requestId: "history" });
  await vi.waitFor(async () => { expect((await triggers.get("night")).history[0]?.outcome.kind).toBe("started"); });
  if (kind === "file") await rm(file()); else await writeFile(file(), prose);
  await triggers.syncFiles(); expect(await triggers.get("night")).toMatchObject({ state: { kind: "paused" }, file: { status: "missing" }, history: [{ outcome: { kind: "started" } }] });
  await writeFile(file(), scheduled()); await triggers.syncFiles(); expect((await triggers.get("night")).state.kind).toBe("active");
  await triggers.close(); await writeFile(file(), prose); await open(); await service?.syncFiles();
  expect((await service?.get("night"))?.file?.status).toBe("missing"); expect(await readFile(file(), "utf8")).toBe(prose); // Migration never rewrites a removed block on later starts.
});
it("keeps last good settings and counts attention when the file is invalid", async () => {
  await writeFile(file(), scheduled()); const triggers = await open(); const initial = await triggers.get("night");
  await writeFile(file(), scheduled('at: "29:00", projects: [Repo]')); await triggers.syncFiles();
  const invalid = await triggers.get("night"); expect(invalid.schedule).toEqual(initial.schedule); expect(invalid.generation).toBe(initial.generation); expect(invalid.state.kind).toBe("active");
  expect(invalid.file).toMatchObject({ status: "invalid", problem: { line: 5 } }); expect((await triggers.list()).attentionCount).toBe(1);
  await triggers.run("night", { requestId: "last-good" }); await vi.waitFor(() => { expect(requests).toHaveLength(1); });
  expect(requests[0]?.action.inputs).toEqual({ scope: "ready" });
  await writeFile(file(), scheduled()); await triggers.syncFiles(); expect((await triggers.list()).attentionCount).toBe(0);
});
it("ignores and diagnoses project-copy schedules", async () => {
  await mkdir(join(cwd, ".pi", "prompts"), { recursive: true }); await writeFile(join(cwd, ".pi", "prompts", "night.md"), scheduled());
  const triggers = await open(); expect((await triggers.list()).triggers).toEqual([]);
  expect((await triggers.workflows(cwd)).diagnostics[0]?.error).toContain("ignored");
});
it("rejects unknown and ambiguous names, and writes unique names or absolute paths", async () => {
  await writeFile(file(), scheduled('at: "03:00", projects: [Unknown]')); const triggers = await open(); expect((await triggers.list()).triggers).toEqual([]); expect(String(errors[0])).toContain("Unknown project");
  const other = join(root, "other"); await mkdir(other); await projects.add({ path: other, name: "Repo" });
  await writeFile(file(), scheduled()); await triggers.syncFiles(); expect(String(errors.at(-1))).toContain("Ambiguous");
  await writeFile(file(), prose);
  await triggers.create({ name: "Night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: "night", targets: { kind: "projects", cwds: [cwd] }, inputs: {} } });
  expect((await triggers.file("night")).schedule?.projects).toEqual([cwd]);
});
it("injects the watcher and the 60 second fallback and closes both", async () => {
  let watched: (() => void) | undefined; let tick: (() => void) | undefined; let closed = 0;
  const triggers = await open({ fileSync: { watch: (directory, callback) => { expect(directory).toBe(join(agent, "prompts")); watched = callback; return { close: () => { closed++; } }; }, interval: (callback, ms) => { expect(ms).toBe(60_000); tick = callback; return () => { closed++; }; } } });
  await writeFile(file(), scheduled()); watched?.(); await vi.waitFor(async () => { expect((await triggers.list()).triggers).toHaveLength(1); });
  await writeFile(file(), scheduled('at: "05:00", projects: [Repo]')); tick?.(); await vi.waitFor(async () => { expect((await triggers.get("night")).schedule.at).toBe("05:00"); });
  await triggers.close(); expect(closed).toBe(2);
});
it("creates only from an existing unscheduled global workflow, and delete removes the block", async () => {
  const triggers = await open(); const input = { name: "Night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: "night", targets: { kind: "projects", cwds: [cwd] }, inputs: {} } };
  await expect(triggers.create(input)).rejects.toMatchObject({ status: 400 });
  await writeFile(file(), prose); const created = await triggers.create({ ...input, id: "ignored-old-id" }); expect(created.id).toBe("night"); expect((await triggers.file("night")).schedule?.projects).toEqual(["Repo"]);
  await expect(triggers.create(input)).rejects.toMatchObject({ status: 400 });
  await triggers.remove("night"); expect(await readFile(file(), "utf8")).not.toContain("schedule:"); expect((await triggers.list()).triggers).toEqual([]);
});
it("migrates a stored trigger with history and a sleeping pending task without re-arming it", async () => {
  await writeFile(file(), prose);
  const registry = createRegistry(); const core = durableTriggers({ now: () => Date.parse("2026-10-13T00:00:00Z"), fire: () => Promise.resolve({ sessionId: "old", cwd, runId: "old-run" }) }); registry.install(core.extension);
  await mkdir(join(root, "triggers")); const harness = await Harness.open(await openNodeSqliteStorage(join(root, "triggers", "state.sqlite")), { models: createModels(), registry, now: () => Date.parse("2026-10-13T00:00:00Z") }, context);
  const anchor = (await harness.root(context)).id; await core.initialize(harness, context);
  await core.create(harness, anchor, { id: "old-night", name: "Old night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: "night", targets: { kind: "projects", cwds: [cwd] }, inputs: { scope: "ready" } } }, context);
  harness.resume(); const manual = await core.run(harness, anchor, "old-night", "history", context);
  await vi.waitFor(async () => { const { listTriggers } = await import("./durableTriggers.js"); expect((await listTriggers(harness, context))[0]?.history[0]?.outcome.kind).toBe("started"); });
  const { listTriggers } = await import("./durableTriggers.js"); const before = (await listTriggers(harness, context))[0]; await harness.close(context);
  const clock = Date.parse("2026-10-13T02:59:59.800Z") - Date.now(); const triggers = await open({ now: () => Date.now() + clock });
  const migrated = await triggers.get("night"); expect(migrated).toMatchObject({ name: "Old night", generation: before?.generation, history: before?.history });
  expect((await triggers.versions("night")).versions[0]?.source).toBe("migration");
  expect(await triggers.run("night", { requestId: "history" })).toEqual(manual);
  await vi.waitFor(async () => { expect((await triggers.get("night")).history).toHaveLength(2); expect(requests).toHaveLength(1); }, { timeout: 3000 });
  expect(requests[0]?.requestId).toBe(`trigger-night-${String(Date.parse("2026-10-13T03:00:00Z"))}`);
});

it.each(["pause", "resume", "remove", "update"] as const)("refuses agent %s after an outside edit widens targets before the watcher runs", async (operation) => {
  await writeFile(file(), scheduled()); const triggers = await open(); const record = await triggers.get("night", cwd);
  await writeFile(file(), scheduled('at: "03:00", projects: all'));
  await expect(operation === "update" ? triggers.update("night", { baseRevision: record.revision, name: "Hijacked" }, cwd) : triggers[operation]("night", cwd)).rejects.toMatchObject({ status: 400 });
  expect((await triggers.get("night")).action.targets).toEqual({ kind: "all" });
  expect((await triggers.file("night")).schedule?.name).toBeUndefined();
});

async function seedStored(records: { id: string; workflow: string; paused?: boolean }[], pendingWrite = false) {
  const registry = createRegistry(); const core = durableTriggers({ now: () => Date.parse("2026-10-13T00:00:00Z"), fire: () => Promise.resolve({ sessionId: "seed", cwd, runId: "seed" }) }); registry.install(core.extension);
  await mkdir(join(root, "triggers")); const harness = await Harness.open(await openNodeSqliteStorage(join(root, "triggers", "state.sqlite")), { models: createModels(), registry }, context);
  try {
    const anchor = (await harness.root(context)).id; await core.initialize(harness, context);
    for (const record of records) {
      await core.create(harness, anchor, { id: record.id, name: record.id, schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: record.workflow, targets: { kind: "projects", cwds: [cwd] }, inputs: { scope: "ready" } } }, context);
      if (record.paused === true) await core.pause(harness, record.id, context);
      if (pendingWrite) await core.planFileMigration(harness, record.id, record.workflow, context);
    }
  } finally { await harness.close(context); }
}
it("migrates paused records and retains project-only and already-scheduled legacy records with diagnostics", async () => {
  await writeFile(file(), prose);
  await mkdir(join(cwd, ".pi", "prompts"), { recursive: true }); await writeFile(join(cwd, ".pi", "prompts", "local.md"), prose);
  await writeFile(join(agent, "prompts", "existing.md"), scheduled('at: "04:00", projects: all'));
  await seedStored([{ id: "old-paused", workflow: "night", paused: true }, { id: "project-only", workflow: "local", paused: true }, { id: "conflict", workflow: "existing", paused: true }]);
  const triggers = await open();
  expect(await triggers.get("night")).toMatchObject({ state: { kind: "paused" }, file: { status: "ok" } });
  expect((await triggers.file("night")).schedule?.paused).toBe(true);
  expect(await triggers.get("project-only")).toMatchObject({ action: { workflow: "local" }, state: { kind: "paused" } });
  expect(await triggers.get("conflict")).toMatchObject({ action: { workflow: "existing" }, state: { kind: "paused" } });
  expect(errors.map(String).join("\n")).toContain("was not migrated"); expect(errors).toHaveLength(2);
});
it("recovers a migration interrupted after writing the file but before re-keying", async () => {
  await seedStored([{ id: "old-night", workflow: "night" }], true);
  await writeFile(file(), scheduled('name: old-night, at: "03:00", timezone: UTC, projects: [Repo]'));
  const triggers = await open();
  expect((await triggers.list()).triggers.map((record) => record.id)).toEqual(["night"]);
  expect((await triggers.get("night")).generation).toBe(1); expect(requests).toEqual([]); expect(errors).toEqual([]);
});
it("the default fs.watch adapter finds an outside edit without an explicit scan", async () => {
  const triggers = await open({ fileSync: { interval: quietInterval } });
  await writeFile(file(), scheduled()); await vi.waitFor(async () => { expect((await triggers.list()).triggers.map((record) => record.id)).toEqual(["night"]); });
});

it("does not re-arm prose edits, updates lastGoodAt only for changed valid bytes, and normalizes server-written target names", async () => {
  let now = Date.parse("2026-10-13T00:00:00Z");
  await writeFile(file(), scheduled()); const triggers = await open({ now: () => now }); const initial = await triggers.get("night");
  now += 1_000; await writeFile(file(), scheduled().replace("Review.", "Review carefully.")); await triggers.syncFiles();
  const changed = await triggers.get("night"); expect(changed.generation).toBe(initial.generation); expect(changed.file?.lastGoodAt).toBe(now);
  now += 1_000; await triggers.syncFiles(); expect((await triggers.get("night")).file?.lastGoodAt).toBe(changed.file?.lastGoodAt);
  const document = await triggers.file("night");
  const saved = await triggers.saveFile("night", { text: document.text, baseSha256: document.sha256, schedule: { at: "03:00", projects: [cwd] } });
  expect(saved.document.schedule?.projects).toEqual(["Repo"]);
  await rm(file()); await triggers.syncFiles();
  await expect(triggers.saveFile("night", { text: document.text, baseSha256: saved.document.sha256 })).rejects.toMatchObject({ status: 404 });
});
it("attributes only the agent's own file when create also discovers an outside schedule", async () => {
  await writeFile(file(), prose); const triggers = await open();
  await writeFile(join(agent, "prompts", "outside.md"), scheduled('at: "03:00", projects: all'));
  const creator = { kind: "agent" as const, sessionId: "caller", cwd };
  const own = await triggers.create({ name: "Own", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: "night", targets: { kind: "projects", cwds: [cwd] }, inputs: {} } }, creator, cwd);
  expect(own.createdBy).toEqual(creator);
  expect((await triggers.get("outside")).createdBy).toEqual({ kind: "user" });
});

async function watchedHost() {
  const scans = vi.spyOn(TriggerFileSync.prototype, "scan");
  const delayed = new Set<() => void>();
  let changed: () => void = () => { throw new Error("Watcher is not open"); };
  let tick: () => void = () => { throw new Error("Fallback is not open"); };
  await writeFile(file(), scheduled());
  const triggers = await open({ fileSync: {
    watch: (_directory, callback) => { changed = callback; return { close: () => undefined }; },
    interval: (callback, milliseconds) => { expect(milliseconds).toBe(60_000); tick = callback; return () => undefined; },
    timeout: (callback: () => void, milliseconds: number) => { expect(milliseconds).toBe(150); delayed.add(callback); return () => { delayed.delete(callback); }; },
  } });
  scans.mockClear();
  return { triggers, scans, delayed, tick: () => { tick(); }, changed: () => { changed(); }, flush: () => { const callbacks = [...delayed]; delayed.clear(); for (const callback of callbacks) callback(); } };
}
async function outsideSave(text: string) {
  const temporary = join(agent, "prompts", ".atomic-save.tmp");
  await writeFile(temporary, text); await rename(temporary, file());
}
it("coalesces ten watch events for one atomic save into one scan and one new version", async () => {
  const host = await watchedHost();
  await outsideSave(scheduled('at: "04:00", projects: [Repo]'));
  for (let i = 0; i < 10; i++) host.changed();
  expect(host.delayed.size).toBe(1); host.flush();
  await vi.waitFor(async () => { expect((await host.triggers.get("night")).schedule.at).toBe("04:00"); });
  expect((await host.triggers.versions("night")).versions).toHaveLength(2);
  await host.triggers.close();
  expect(host.scans).toHaveBeenCalledTimes(1);
  expect(await readdir(join(root, "triggers", "versions", "night"))).toHaveLength(2);
});
it("ignores a Forgerie save's watch echo when its bytes were already synced inline", async () => {
  const host = await watchedHost(); const document = await host.triggers.file("night");
  await host.triggers.saveFile("night", { text: document.text, baseSha256: document.sha256, schedule: { at: "04:00", projects: ["Repo"] } });
  const before = await host.triggers.get("night"); host.scans.mockClear();
  const probes = vi.spyOn(TriggerFiles.prototype, "hashes");
  for (let i = 0; i < 10; i++) host.changed();
  host.flush();
  await vi.waitFor(() => { expect(probes).toHaveBeenCalledTimes(1); });
  const probe = probes.mock.results[0]; if (probe?.type !== "return") throw new Error("No hash probe"); await probe.value;
  expect(await host.triggers.get("night")).toEqual(before);
  await host.triggers.close();
  expect(host.scans).not.toHaveBeenCalled();
  expect(await readdir(join(root, "triggers", "versions", "night"))).toHaveLength(2);
});
it("runs exactly one follow-up for a burst received during a scan, without losing the later edit", async () => {
  const host = await watchedHost();
  let entered!: () => void; let release!: () => void;
  const entering = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const listProjects = projects.list.bind(projects);
  vi.spyOn(projects, "list").mockImplementationOnce(async () => { entered(); await held; return listProjects(); });
  await outsideSave(scheduled('at: "04:00", projects: [Repo]')); host.changed(); host.flush();
  try {
    await entering;
    await outsideSave(scheduled('at: "05:00", projects: [Repo]'));
    for (let i = 0; i < 10; i++) host.changed();
    expect(host.delayed.size).toBe(0);
  } finally { release(); }
  await vi.waitFor(async () => { expect((await host.triggers.get("night")).schedule.at).toBe("05:00"); });
  await host.triggers.close();
  expect(host.scans).toHaveBeenCalledTimes(2);
  expect(await readdir(join(root, "triggers", "versions", "night"))).toHaveLength(3);
});

it("cancels a pending debounce on close and ignores late watch delivery", async () => {
  const host = await watchedHost(); host.changed();
  expect(host.delayed.size).toBe(1); await host.triggers.close();
  expect(host.delayed.size).toBe(0); host.changed(); host.flush();
  expect(host.scans).not.toHaveBeenCalled();
  expect(await readdir(join(root, "triggers", "versions", "night"))).toHaveLength(1);
});
it("the fallback revalidates unchanged file bytes when registered project names change", async () => {
  let tick: () => void = () => undefined;
  const host = await watchedHost(); await host.triggers.close();
  const triggers = await open({ fileSync: { watch: quietWatch, interval: (callback) => { tick = callback; return () => undefined; } } });
  const other = join(root, "another"); await mkdir(other); const duplicate = await projects.add({ path: other, name: "Repo" });
  tick(); await vi.waitFor(async () => { expect((await triggers.get("night")).file?.status).toBe("invalid"); });
  await projects.close(duplicate.id); tick();
  await vi.waitFor(async () => { expect((await triggers.get("night")).file?.status).toBe("ok"); });
  expect((await triggers.versions("night")).versions).toHaveLength(1);
});

it("does not let repeated watch events postpone the fallback beyond its interval", async () => {
  const host = await watchedHost();
  await outsideSave(scheduled('at: "04:00", projects: [Repo]'));
  for (let i = 0; i < 10; i++) host.changed();
  expect(host.delayed.size).toBe(1); host.tick();
  expect(host.delayed.size).toBe(0);
  await vi.waitFor(async () => { expect((await host.triggers.get("night")).schedule.at).toBe("04:00"); });
  await host.triggers.close(); expect(host.scans).toHaveBeenCalledTimes(1);
  expect(await readdir(join(root, "triggers", "versions", "night"))).toHaveLength(2);
});

it("does not let an unchanged legacy file force scans for another file's inline save", async () => {
  await seedStored([{ id: "night", workflow: "night", paused: true }]);
  await writeFile(join(agent, "prompts", "own.md"), prose);
  const host = await watchedHost();
  await host.triggers.create({ name: "Own", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", workflow: "own", targets: { kind: "projects", cwds: [cwd] }, inputs: {} } });
  host.scans.mockClear(); const probes = vi.spyOn(TriggerFiles.prototype, "hashes");
  for (let i = 0; i < 10; i++) host.changed(); host.flush();
  await vi.waitFor(() => { expect(probes).toHaveBeenCalledTimes(1); });
  const probe = probes.mock.results[0]; if (probe?.type !== "return") throw new Error("No hash probe"); await probe.value;
  await host.triggers.close(); expect(host.scans).not.toHaveBeenCalled();
  expect(await readdir(join(root, "triggers", "versions", "own"))).toHaveLength(2);
});

it("starts and keeps valid versions when a prior archive contains partial JSON", async () => {
  await writeFile(file(), scheduled()); const first = await open();
  const original = (await first.versions("night")).versions; await first.close();
  const corrupt = join(root, "triggers", "versions", "night", "corrupt.json"); await writeFile(corrupt, '{"id":');
  const reopened = await open();
  expect((await reopened.get("night")).state.kind).toBe("active");
  expect((await reopened.versions("night")).versions).toEqual(original);
  expect(errors.map(String).join("\n")).toContain("corrupt.json");
  expect((await reopened.version("night", original[0]?.id ?? "")).text).toBe(scheduled());
  await expect(reopened.version("night", "corrupt")).rejects.toMatchObject({ status: 404 });
});
