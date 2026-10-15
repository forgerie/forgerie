import { describe, expect, it } from "vitest";
import { createTriggersApi, runRefusedBeforeAdmission, TriggerRefusal } from "./triggersApi";
import { mixedList, nightly } from "./fixtures/triggers";
import { maintenance, maintenanceDocument, maintenanceVersions, versionList } from "./fixtures/triggerFiles";

/** The client takes its fetch as an argument: the test hands it one that records each request. */
function served(status: number, body: unknown) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const api = createTriggersApi(async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET", ...(typeof init.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { api, calls };
}

describe("the trigger routes", () => {
  it("reads the list, and drops a malformed trigger instead of the list", async () => {
    const { api, calls } = served(200, { ...mixedList, triggers: [...mixedList.triggers, { id: 7 }] });
    const list = await api.list();
    expect(list.triggers.map((trigger) => trigger.id)).toEqual(mixedList.triggers.map((trigger) => trigger.id));
    expect(list.timezones).toContain("UTC");
    expect(calls).toEqual([{ path: "/api/triggers", method: "GET" }]);
  });
  it("sends each write to its route with its body", async () => {
    const { api, calls } = served(200, nightly);
    await api.update("nightly-refinement", { baseRevision: 12, name: "Nightly" });
    await api.pause("nightly-refinement");
    await api.resume("nightly-refinement");
    await api.acknowledge("nightly-refinement");
    await api.get("new");
    expect(calls).toEqual([
      { path: "/api/triggers/nightly-refinement", method: "PATCH", body: { baseRevision: 12, name: "Nightly" } },
      { path: "/api/triggers/nightly-refinement/pause", method: "POST", body: {} },
      { path: "/api/triggers/nightly-refinement/resume", method: "POST", body: {} },
      { path: "/api/triggers/nightly-refinement/acknowledge", method: "POST", body: {} },
      { path: "/api/triggers/new", method: "GET" },
    ]);
  });
  it("runs with the browser's request ID and deletes", async () => {
    // The answer's request ID is the server's, in a form the browser does not build: it is read, never derived.
    const run = served(202, { requestId: "trigger-run:18:nightly-refinement:6:abc123" });
    expect(await run.api.run("nightly-refinement", "abc123")).toEqual({ requestId: "trigger-run:18:nightly-refinement:6:abc123" });
    await run.api.run("nightly-refinement", "abc124", "/code/pi-mono");
    // Every target project unless the reader chose one: `cwd` goes only for that choice.
    expect(run.calls).toEqual([{ path: "/api/triggers/nightly-refinement/run", method: "POST", body: { requestId: "abc123" } },
      { path: "/api/triggers/nightly-refinement/run", method: "POST", body: { requestId: "abc124", cwd: "/code/pi-mono" } }]);
    const remove = served(200, { ok: true });
    expect(await remove.api.remove("nightly-refinement")).toEqual({ ok: true });
    expect(remove.calls).toEqual([{ path: "/api/triggers/nightly-refinement", method: "DELETE" }]);
  });
  it.each([400, 404, 409, 500, 502, 503, 504, 599])("classifies only known pre-admission run refusals: HTTP %i", async (status) => {
    const error = await served(status, { error: "Request failed" }).api.run("nightly-refinement", "abc123").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TriggerRefusal);
    expect(runRefusedBeforeAdmission(error)).toBe(status === 400 || status === 404);
  });
  it("does not treat network, unreadable answers, or unknown errors as proof of non-admission", () => {
    for (const error of [new TypeError("Failed to fetch"), new Error("Unreadable answer"), { status: 400 }, undefined]) {
      expect(runRefusedBeforeAdmission(error)).toBe(false);
    }
  });
  it("refuses a run answer without the server's request ID instead of guessing it", async () => {
    await expect(served(202, {}).api.run("nightly-refinement", "abc123")).rejects.toThrow("Forgerie sent a run answer this app cannot read.");
  });
  it("reads the workflows common to the target projects, with why the others were left out", async () => {
    const diagnostic = { name: "b", path: "/code/pi-mono", error: "Workflow is unavailable in /code/pi-mono" };
    const { api, calls } = served(200, { workflows: [{ name: "a", kind: "prose", inputs: {}, hasLandStop: true }, { name: "b" }], diagnostics: [diagnostic, { name: 3 }] });
    const common = await api.commonWorkflows({ kind: "projects", cwds: ["/code/forgerie", "/code/pi-mono"] });
    expect(common.workflows.map((item) => item.name)).toEqual(["a"]);
    expect(common.diagnostics).toEqual([diagnostic]);
    await api.commonWorkflows({ kind: "all" });
    expect(calls).toEqual([
      { path: "/api/triggers/workflows/common", method: "POST", body: { kind: "projects", cwds: ["/code/forgerie", "/code/pi-mono"] } },
      { path: "/api/triggers/workflows/common", method: "POST", body: { kind: "all" } },
    ]);
  });
  it("drops a trigger that still names one cwd instead of target projects", async () => {
    const { api } = served(200, { ...mixedList, triggers: [{ ...nightly, action: { kind: "workflow", cwd: "/c", workflow: "w", inputs: {} } }, mixedList.triggers[1]] });
    expect((await api.list()).triggers.map((trigger) => trigger.id)).toEqual([mixedList.triggers[1]?.id]);
  });
  it("turns a refusal into its status, message, and field", async () => {
    const { api } = served(400, { error: "Unknown time zone \"Mars/Olympus\".", field: "schedule.timezone" });
    const refusal = await api.create({ name: "x", schedule: { kind: "daily", at: "03:00", timezone: "Mars/Olympus" },
      action: { kind: "workflow", targets: { kind: "projects", cwds: ["/c"] }, workflow: "w", inputs: {} } }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TriggerRefusal);
    expect(refusal).toMatchObject({ status: 400, field: "schedule.timezone", message: "Unknown time zone \"Mars/Olympus\"." });
    const off = await served(503, { error: "database is locked" }).api.list().catch((error: unknown) => error);
    expect(off).toMatchObject({ status: 503, message: "database is locked" });
  });
  it("reads and writes a trigger's workflow file and its versions on their routes", async () => {
    const read = served(200, maintenanceDocument);
    expect(await read.api.file("nightly-maintenance")).toEqual(maintenanceDocument);
    const save = served(200, { trigger: maintenance, document: maintenanceDocument });
    const body = { text: maintenanceDocument.text, baseSha256: maintenanceDocument.sha256, schedule: { at: "02:00", projects: "all" as const } };
    expect(await save.api.saveFile("nightly-maintenance", body)).toEqual({ trigger: maintenance, document: maintenanceDocument });
    const list = served(200, { versions: [...versionList, { id: "x" }] });
    expect((await list.api.versions("nightly-maintenance")).versions.map((version) => version.id)).toEqual(["v3", "v2", "v1"]);
    const one = served(200, maintenanceVersions[1]);
    expect(await one.api.version("nightly-maintenance", "v2")).toEqual(maintenanceVersions[1]);
    expect([...read.calls, ...save.calls, ...list.calls, ...one.calls]).toEqual([
      { path: "/api/triggers/nightly-maintenance/file", method: "GET" },
      { path: "/api/triggers/nightly-maintenance/file", method: "PUT", body },
      { path: "/api/triggers/nightly-maintenance/versions", method: "GET" },
      { path: "/api/triggers/nightly-maintenance/versions/v2", method: "GET" },
    ]);
  });
  it("carries the line of a file that would not run, and only a whole line number", async () => {
    const refused = await served(400, { error: "`at` must be a time.", field: "schedule.at", line: 5 }).api
      .saveFile("nightly-maintenance", { text: "", baseSha256: "a".repeat(64) }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 400, field: "schedule.at", line: 5, message: "`at` must be a time." });
    const odd = await served(400, { error: "Bad.", line: "5" }).api.file("x").catch((error: unknown) => error);
    expect(odd).toMatchObject({ status: 400, line: undefined });
  });
  it("refuses a file answer it cannot read instead of showing a part of it", async () => {
    await expect(served(200, { path: "/p", text: "x" }).api.file("x")).rejects.toThrow("Forgerie sent a workflow file this app cannot read.");
  });
});
