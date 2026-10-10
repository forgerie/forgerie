import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceServicesStore, type WorkspaceServicesRecord } from "./workspaceServicesStore.js";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fg-inventory-")); roots.push(root);
  const store = new WorkspaceServicesStore(join(root, "inventory")); await store.initialize();
  const record: WorkspaceServicesRecord = { worktreeId: "one", cwd: root, directory: root, socket: join(root, "pc.sock"), tokenFile: join(root, "token"), ports: { web: 23456 }, phase: "stopped" };
  return { root, store, record };
}

it("persists concurrent records atomically and returns independent snapshots", async () => {
  const f = await fixture();
  try {
    await Promise.all([f.store.put(f.record), f.store.put({ ...f.record, worktreeId: "two" })]);
    const records = f.store.list();
    if (records[0] !== undefined) records[0].ports["web"] = 1;
    expect(f.store.get("one")?.ports["web"]).toBe(23456);
    await f.store.dispose();
    const restored = new WorkspaceServicesStore(f.store.directory); await restored.initialize();
    try { expect(restored.list()).toHaveLength(2); expect(restored.get("missing")).toBeUndefined(); }
    finally { await restored.dispose(); }
    expect(await readFile(join(f.store.directory, "instances.json"), "utf8")).toContain('"two"');
    expect(() => f.store.list()).toThrow("lock is unavailable");
  } finally { await f.store.dispose(); }
});

it.each(["not json", JSON.stringify([{ worktreeId: "bad" }])])("refuses a corrupt inventory and releases admission after failure", async (data) => {
  const f = await fixture(); await f.store.dispose();
  await writeFile(join(f.store.directory, "instances.json"), data);
  const restored = new WorkspaceServicesStore(f.store.directory);
  await expect(restored.initialize()).rejects.toThrow();
  await writeFile(join(f.store.directory, "instances.json"), "[]");
  const replacement = new WorkspaceServicesStore(f.store.directory); await replacement.initialize(); await replacement.dispose();
});

it("rejects reads and writes after its real inventory lock is removed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = await fixture();
  try {
    await f.store.put(f.record);
    await rm(`${f.store.directory}.lock`, { recursive: true });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => { expect(() => f.store.list()).toThrow("lock is unavailable"); });
    await expect(f.store.put({ ...f.record, worktreeId: "two" })).rejects.toThrow("lock is unavailable");
    expect(await readFile(join(f.store.directory, "instances.json"), "utf8")).not.toContain('"two"');
  } finally { await f.store.dispose().catch(() => undefined); }
});

it("rejects duplicate persisted worktree identities", async () => {
  const f = await fixture(); await f.store.dispose();
  await writeFile(join(f.store.directory, "instances.json"), JSON.stringify([f.record, f.record]));
  await expect(new WorkspaceServicesStore(f.store.directory).initialize()).rejects.toThrow("Duplicate");
});
