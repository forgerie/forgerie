import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionRunStore, keyOf } from "./actionRunStore.js";

const input = { id: "s1", cwd: "/workspace", repo: "owner/repo", runId: 4812, source: "manual" as const };
describe("action run persistence", () => {
  it("round trips version 1, rejects stale revisions, preserves source/order and clones public reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-store-"));
    try {
      const path = join(dir, "action-runs.json");
      const store = new ActionRunStore(path); await store.initialize();
      const first = await store.link(input);
      await store.link({ ...input, runId: 4813 });
      expect(await store.link({ ...input, source: "pull" })).toEqual(first);
      const next = await store.update(keyOf(first), first.revision, record => ({ ...record, conclusion: "failure", pending: { id: "notice", text: "news" } }));
      expect(next?.revision).toBe(1);
      expect(await store.update(keyOf(first), 0, record => record)).toBeUndefined();
      first.repo = "bad/repo";
      const recovered = new ActionRunStore(path); await recovered.initialize();
      expect(recovered.list().map(record => record.runId)).toEqual([4812, 4813]);
      expect(recovered.get(input)?.pending).toEqual({ id: "notice", text: "news" });
      expect(recovered.get(input)?.conclusion).toBe("failure");
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
      await recovered.unlink(input);
      expect(recovered.list().map(record => record.runId)).toEqual([4813]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("atomically starts a watch or keeps the existing watch and durable news unchanged", async () => {
    const store = new ActionRunStore();
    const start = { since: "2026-10-01T12:00:00Z", leaf: "start", cursor: { attempt: 1, failed: [], concluded: false } };
    expect(await store.startWatch(input, start, () => false)).toBeUndefined();
    expect(store.list()).toEqual([]);
    const first = await store.startWatch(input, start, () => true);
    if (first === undefined) throw new Error("Watch did not start");
    expect(first).toMatchObject({ revision: 0, watch: { kind: "watching", wakes: 0 } });
    const news = await store.update(input, first.revision, record => ({ ...record, cursor: { ...start.cursor, failed: ["1:10"] },
      watch: { kind: "watching", since: start.since, wakes: 1 }, pending: { id: "notice", text: "durable news" } }));
    expect(await store.startWatch({ ...input, source: "pull" }, start, () => true)).toEqual(news);
    expect(store.get(input)).toEqual(news);
  });
  it("does not leave a link behind when the atomic start write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-start-write-"));
    try {
      const store = new ActionRunStore(dir);
      await expect(store.startWatch(input, { since: "2026-10-01T12:00:00Z", leaf: null, cursor: { attempt: 1, failed: [], concluded: false } }, () => true)).rejects.toThrow();
      expect(store.list()).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("accepts legacy records without a conclusion and rejects invalid typed conclusions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-conclusion-"));
    try {
      const record = await new ActionRunStore().link(input);
      const path = join(dir, "action-runs.json");
      await writeFile(path, JSON.stringify({ version: 1, records: [record] }));
      const store = new ActionRunStore(path); await store.initialize();
      expect(store.get(input)?.conclusion).toBeUndefined();
      await writeFile(path, JSON.stringify({ version: 1, records: [{ ...record, conclusion: "invalid" }] }));
      await expect(new ActionRunStore(path).initialize()).rejects.toThrow("Invalid action run state");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("refuses malformed or duplicate state and does not publish a failed atomic write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-store-invalid-"));
    try {
      const path = join(dir, "runs.json");
      await writeFile(path, '{"version":1,"records":"bad"}');
      await expect(new ActionRunStore(path).initialize()).rejects.toThrow("Invalid action run");
      const store = new ActionRunStore(); const record = await store.link(input);
      await writeFile(path, JSON.stringify({ version: 1, records: [record, { ...record, repo: "Owner/Repo" }] }));
      await expect(new ActionRunStore(path).initialize()).rejects.toThrow("Duplicate");
      const failed = new ActionRunStore(dir);
      await expect(failed.link(input)).rejects.toThrow();
      expect(failed.list()).toEqual([]);
      await expect(store.link({ ...input, cwd: "/other" })).rejects.toThrow("another workspace");
      await expect(store.update(input, 0, value => ({ ...value, session: { ...value.session, cwd: "/other" } }))).rejects.toThrow("Invalid action run");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
