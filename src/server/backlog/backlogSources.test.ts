import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { registerBacklogSettingsRoutes } from "./backlogSettingsRoutes.js";
import type { BacklogSource } from "../../shared/backlogSources.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "backlog-sources-")); roots.push(root);
  const path = join(root, "backlog-settings.json");
  const project = { id: "p", name: "Project", path: join(root, "repo"), createdAt: "today" };
  await mkdir(project.path);
  const store = new BacklogSettingsStore(path, { projects: () => Promise.resolve([project]) });
  return { root, path, store, project };
}
it("creates, replaces and deletes sources with file-wide revisions and no ABA", async () => {
  const { store } = await fixture();
  const a = await store.createSource({ organization: "Org", project: "Board" });
  expect(a).toMatchObject({ provider: "azure-devops", revision: 1 });
  expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(store.saveSource(a.id, { organization: "Org", project: "Board" }, 0)).rejects.toThrow("changed");
  const b = await store.saveSource(a.id, { organization: "Org", project: "Board", destinationProjectId: "p" }, a.revision);
  expect(b.revision).toBe(2);
  await expect(store.removeSource(a.id, a.revision)).rejects.toThrow("changed");
  await store.removeSource(a.id, b.revision);
  expect(Object.values((await store.read()).sources)).toEqual([]);
  expect((await store.createSource({ organization: "Org", project: "Board" })).revision).toBeGreaterThan(b.revision);
});
it.each([[undefined, "A"], ["A", "a"], ["A", "A\\B"]])("refuses overlapping sources (%s, %s) without writing", async (a, b) => {
  const { store, path } = await fixture();
  await store.createSource({ organization: "Org", project: "Board", ...(a === undefined ? {} : { areaPath: a }) });
  const before = await readFile(path, "utf8");
  await expect(store.createSource({ organization: "org", project: "board", areaPath: b })).rejects.toThrow("Overlaps Org / Board");
  expect(await readFile(path, "utf8")).toBe(before);
});
it("permits sibling segment prefixes and different boards, but rejects overlapping updates", async () => {
  const { store } = await fixture();
  const a = await store.createSource({ organization: "Org", project: "Board", areaPath: "A\\B" });
  const b = await store.createSource({ organization: "org", project: "board", areaPath: "A\\Bc" });
  await store.createSource({ organization: "Other", project: "Board" });
  await store.createSource({ organization: "Org", project: "Other" });
  await expect(store.saveSource(b.id, { organization: "Org", project: "Board", areaPath: "A" }, b.revision)).rejects.toThrow("Overlaps");
  expect((await store.read()).sources[a.id]).toEqual(a);
});
it("migrates identical settings and unconfigured repo Azure sections once, retaining project providers and the original backup", async () => {
  const f = await fixture();
  const azure = { organization: "Org", project: "Board" };
  const entries = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, { backlog: { providers: id === "a" ? ["markdown", "azure-devops"] : ["azure-devops"], azureDevops: azure }, revision: 1, updatedAt: "today" }]));
  await mkdir(join(f.project.path, ".forgerie"));
  await writeFile(join(f.project.path, ".forgerie/config.json"), JSON.stringify({ backlog: { providers: ["azure-devops"], azureDevops: { ...azure, areaPath: "Area" } } }));
  const original = JSON.stringify({ version: 1, githubLogin: "octocat", projects: entries });
  await writeFile(f.path, original);
  const file = await f.store.read();
  expect(file.version).toBe(2); expect(file.githubLogin).toBe("octocat");
  expect(Object.values(file.sources)).toHaveLength(2);
  expect(Object.values(file.sources).every((source) => source.destinationProjectId === undefined)).toBe(true);
  expect(file.projects).toEqual({ a: { backlog: { providers: ["markdown"] }, revision: 1, updatedAt: "today" } });
  const backup = join(f.root, "backlog-settings.v1.json");
  expect(await readFile(backup, "utf8")).toBe(original); expect((await stat(backup)).mode & 0o777).toBe(0o600);
  expect(await f.store.read()).toEqual(file);
  await writeFile(f.path, original); await writeFile(backup, "keep existing backup"); await f.store.read();
  expect(await readFile(backup, "utf8")).toBe("keep existing backup");
});
it("leaves version 1 intact when migration cannot write a backup", async () => {
  const f = await fixture(); const original = JSON.stringify({ version: 1, projects: {} });
  await writeFile(f.path, original);
  // An existing directory is not a valid backup. Migration must not overwrite or accept it.
  await mkdir(join(f.root, "backlog-settings.v1.json"));
  await expect(f.store.read()).rejects.toThrow("Cannot read backlog-settings.json");
  expect(await readFile(f.path, "utf8")).toBe(original);
});
it("validates source HTTP bodies, destinations, conflicts and revisions", async () => {
  const f = await fixture(); const app = Fastify();
  registerBacklogSettingsRoutes(app, f.store, { list: () => Promise.resolve([f.project]), requireProject: (id) => id === "p" ? Promise.resolve(f.project) : Promise.reject(new Error("Project not found")) });
  try {
    const url = "/backlog/settings/sources";
    expect((await app.inject({ method: "POST", url, payload: { organization: "Org", project: "Board", destinationProjectId: "gone" } })).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url, payload: { organization: "Org", project: "Board", destinationProjectId: "p" } });
    expect(created.statusCode).toBe(200); const source = created.json<BacklogSource>();
    expect((await app.inject({ method: "GET", url: "/backlog/settings" })).json()).toMatchObject({ sources: [{ ...source, warnings: [] }] });
    expect((await app.inject({ method: "POST", url, payload: { organization: "org", project: "board" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: `${url}/${source.id}`, payload: { organization: "Org", project: "Board", baseRevision: 999 } })).statusCode).toBe(409);
    const saved = await app.inject({ method: "PUT", url: `${url}/${source.id}`, payload: { organization: "Org", project: "Other", baseRevision: source.revision } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `${url}/${source.id}`, payload: { baseRevision: saved.json<BacklogSource>().revision } })).statusCode).toBe(200);
  } finally { await app.close(); }
});

it("fails closed after backing up when the version 2 replacement cannot be written", async () => {
  const { chmod } = await import("node:fs/promises");
  const f = await fixture(); const original = JSON.stringify({ version: 1, projects: {} });
  await writeFile(f.path, original); await writeFile(join(f.root, "backlog-settings.v1.json"), original, { mode: 0o600 });
  await chmod(f.root, 0o500);
  try {
    await expect(f.store.read()).rejects.toThrow("Cannot read backlog-settings.json");
    expect(await readFile(f.path, "utf8")).toBe(original);
  } finally { await chmod(f.root, 0o700); }
  expect((await f.store.read()).version).toBe(2);
});
it("retires even malformed repo Azure sections and reports retirement under a stored project override", async () => {
  const f = await fixture();
  const { resolveBacklogConfig } = await import("./backlogConfig.js");
  const { scanProjectBacklog } = await import("./backlogScanner.js");
  await mkdir(join(f.project.path, ".forgerie"));
  await writeFile(join(f.project.path, ".forgerie/config.json"), JSON.stringify({ backlog: { providers: ["azure-devops"], azureDevops: { invalid: "retired" } } }));
  expect(await resolveBacklogConfig(f.project, f.project.path, f.store)).toMatchObject({ backlog: { providers: ["markdown"] }, warnings: [expect.stringContaining("now reads Azure boards")] });
  await f.store.save("p", { providers: ["github"] }, 0);
  expect(await resolveBacklogConfig(f.project, f.project.path, f.store)).toMatchObject({ source: "forgerie", backlog: { providers: ["github"] }, warnings: [expect.stringContaining("now reads Azure boards")] });
  expect((await scanProjectBacklog(f.project, [], undefined, { settings: f.store })).warnings).toMatchObject([{ kind: "retired-repo-azure", projectId: "p" }]);
});
