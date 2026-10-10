import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildRun } from "../../shared/childRuns.js";
import { ChildRunStore } from "./childRunStore.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const now = Date.UTC(2026, 9, 9);
function run(id: string, end?: number): ChildRun {
  return { id, session: { id: "parent", cwd: "/repo" }, child: { name: "builder", conversationId: 2, agent: "worker" },
    model: { provider: "test", modelId: "small" }, startedAt: (end ?? now) - 100,
    state: end === undefined ? { kind: "running" } : { kind: "finished", outcome: "answered", finishedAt: end, durationMs: 100, timing: "observed" },
    turns: 2, usage: { models: {}, tools: {} } };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-child-runs-")); roots.push(root);
  const path = join(root, "records.json");
  return { path, store: new ChildRunStore(path, () => now) };
}

describe("child run records on disk", () => {
  it("writes, completes, reopens, and keeps completed records immutable on replay", async () => {
    const f = await fixture();
    await f.store.save(run("one"));
    const done = run("one", now);
    await f.store.save(done);
    await f.store.save(run("one"));
    const reopened = new ChildRunStore(f.path, () => now);
    const records = await reopened.list();
    expect(records).toEqual([done]);
    records.length = 0;
    expect(await reopened.list()).toEqual([done]);
  });

  it("filters by exact session and agent, including the combined filter", async () => {
    const f = await fixture();
    const other = run("two", now);
    other.session.id = "other"; other.child.agent = "scout";
    await f.store.save(run("one", now)); await f.store.save(other);
    expect((await f.store.list({ session: "parent" })).map((item) => item.id)).toEqual(["one"]);
    expect((await f.store.list({ agent: "scout" })).map((item) => item.id)).toEqual(["two"]);
    expect(await f.store.list({ session: "parent", agent: "scout" })).toEqual([]);
    expect(await f.store.list({ session: "par" })).toEqual([]);
  });

  it("expires completed records at 90 days, persists pruning, and keeps unfinished runs", async () => {
    const f = await fixture();
    const cutoff = now - 90 * 86_400_000;
    const old = run("old", cutoff);
    await f.store.save({ ...old, state: { kind: "running" } });
    expect((await f.store.list()).map((row) => row.id)).toEqual(["old"]);
    await f.store.save(old);
    await f.store.save(run("recent", cutoff + 1));
    const active = run("unfinished"); active.startedAt = 1;
    await f.store.save(active);
    expect((await f.store.list()).map((item) => item.id).sort()).toEqual(["recent", "unfinished"]);
    expect(await readFile(f.path, "utf8")).not.toContain('"old"');
    expect((await new ChildRunStore(f.path, () => now).list()).map((item) => item.id).sort()).toEqual(["recent", "unfinished"]);
  });

  it("prunes on its timer and stops the timer without touching unfinished records", async () => {
    const f = await fixture();
    let clock = now;
    const store = new ChildRunStore(f.path, () => clock);
    await store.save(run("done", now)); await store.save(run("live"));
    const errors: unknown[] = [];
    store.start((error) => { errors.push(error); }, 5);
    try {
      clock += 90 * 86_400_000;
      await vi.waitFor(async () => { expect(await readFile(f.path, "utf8")).not.toContain('"done"'); });
      expect((await store.list()).map((row) => row.id)).toEqual(["live"]);
      expect(errors).toEqual([]);
    } finally { await store.stop(); }
  });

  it("serializes concurrent writes without losing records", async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 12 }, (_, n) => f.store.save(run(`run-${String(n)}`, now))));
    expect(await f.store.list()).toHaveLength(12);
  });

  it("refuses corrupted files and invalid timing without overwriting data", async () => {
    const f = await fixture();
    await writeFile(f.path, "broken");
    await expect(f.store.save(run("one"))).rejects.toThrow();
    expect(await readFile(f.path, "utf8")).toBe("broken");
    await rm(f.path); await mkdir(f.path);
    await expect(f.store.save(run("one"))).rejects.toThrow();
    await rm(f.path, { recursive: true });
    const invalid = run("one", now);
    if (invalid.state.kind === "finished") invalid.state.durationMs = 99;
    await expect(f.store.save(invalid)).rejects.toThrow("timing");
  });
});
