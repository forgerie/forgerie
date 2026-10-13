import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { resolveBacklogConfig } from "./backlogConfig.js";
import { scanProjectBacklog } from "./backlogScanner.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "backlog-settings-")); roots.push(root);
  const path = join(root, "backlog-settings.json"); const store = new BacklogSettingsStore(path);
  const project = { id: "p", name: "Project", path: root, createdAt: "today" };
  return { root, path, store, project };
}
it("round trips private atomic snapshots and serializes stale writes", async () => {
  const f = await fixture();
  await f.store.setGitHubLogin("octocat");
  const writes = await Promise.allSettled([f.store.save("p", { providers: ["github"] }, 0), f.store.save("p", { providers: ["markdown"] }, 0)]);
  expect(writes.map((w) => w.status)).toEqual(["fulfilled", "rejected"]);
  expect((await new BacklogSettingsStore(f.path).read()).projects["p"]).toMatchObject({ revision: 1, backlog: { providers: ["github"] } });
  expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  expect((await readdir(f.root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  await expect(f.store.remove("p", 0)).rejects.toThrow("changed");
  const inode = (await stat(f.path)).ino;
  await f.store.remove("p", 1);
  expect((await stat(f.path)).ino).not.toBe(inode);
  expect(await f.store.read()).toEqual({ version: 1, revision: 1, githubLogin: "octocat", projects: {} });
});
it("prefers the whole stored section, then the repo, then markdown; Azure-only never scans files", async () => {
  const f = await fixture();
  expect(await resolveBacklogConfig(f.project, f.root, f.store)).toMatchObject({ source: "default", backlog: { providers: ["markdown"] } });
  await mkdir(join(f.root, ".forgerie"));
  await writeFile(join(f.root, ".forgerie/config.json"), JSON.stringify({ backlog: { dir: "work/items", providers: ["markdown", "github"] } }));
  expect(await resolveBacklogConfig(f.project, f.root, f.store)).toMatchObject({ source: "repo-file", backlog: { dir: "work/items" } });
  await mkdir(join(f.root, "work/items"), { recursive: true });
  await writeFile(join(f.root, "work/items/item.md"), "---\nid: one\ntitle: One\n---\n");
  await f.store.save("p", { providers: ["azure-devops"] }, 0);
  await writeFile(join(f.root, ".forgerie/config.json"), "{ invalid ignored config");
  expect(await resolveBacklogConfig(f.project, f.root, f.store)).toMatchObject({ source: "forgerie", backlog: { providers: ["azure-devops"] }, revision: 1 });
  expect((await scanProjectBacklog(f.project, [], undefined, { settings: f.store })).entries).toEqual([]);
  await writeFile(join(f.root, ".forgerie/config.json"), JSON.stringify({ backlog: { dir: "work/items", providers: ["markdown", "github"] } }));
  await f.store.remove("p", 1);
  const scan = await scanProjectBacklog(f.project, [], undefined, { settings: f.store });
  expect(scan.entries[0]?.item).toMatchObject({ assignedToMe: true, assignees: [] });
  expect(JSON.parse(await readFile(f.path, "utf8"))).toMatchObject({ projects: {} });
});
it("rejects credentials, unsafe directories, missing sources, and invalid logins without overwriting", async () => {
  const f = await fixture();
  await f.store.save("p", { providers: ["markdown"] }, 0); const before = await readFile(f.path, "utf8");
  await expect(f.store.save("p", { dir: "../secrets", providers: ["markdown"] }, 1)).rejects.toThrow();
  await expect(f.store.save("p", {}, 1)).rejects.toThrow();
  await expect(f.store.setGitHubLogin("a--b")).rejects.toThrow();
  expect(await readFile(f.path, "utf8")).toBe(before);
  await writeFile(f.path, "test-only-secret-invalid-json");
  await expect(f.store.read()).rejects.toThrow("Invalid backlog settings file; it has not been overwritten.");
  await mkdir(join(f.root, ".forgerie"));
  await writeFile(join(f.root, ".forgerie/config.json"), "test-only-secret-invalid-json");
  await expect(resolveBacklogConfig(f.project, f.root)).rejects.toThrow("Invalid JSON in .forgerie/config.json.");
});

it("never accepts a deleted entry's revision after the project override is recreated", async () => {
  const f = await fixture(); await f.store.save("p", { providers: ["markdown"] }, 0);
  const file = await f.store.read(); const old = file.projects["p"]?.revision;
  if (old === undefined) throw new Error("Missing saved entry");
  // Files matching the original v1 shape remain readable and safe to delete.
  delete file.revision; await writeFile(f.path, JSON.stringify(file));
  await f.store.remove("p", old);
  const restarted = new BacklogSettingsStore(f.path); await restarted.save("p", { providers: ["github"] }, 0);
  expect((await restarted.read()).projects["p"]?.revision).toBe(old + 1);
  await expect(restarted.save("p", { providers: ["markdown"] }, old)).rejects.toThrow("changed");
});
