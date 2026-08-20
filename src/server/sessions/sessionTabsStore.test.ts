import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_TABS_PER_SESSION_LIMIT, SESSION_TABS_SESSION_LIMIT } from "../../shared/apiTypes.js";
import { SessionTabsStore, parseSessionTabsFile } from "./sessionTabsStore.js";

const GIT = "core:workspace.git";
const TERMINAL = "core:workspace.terminal";

describe("SessionTabsStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempFile(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "session-tabs-store-"));
    tempDirs.push(dir);
    return join(dir, "session-tabs.json");
  }

  it("stores a tab set, reports the change, and deduplicates entries", async () => {
    const store = new SessionTabsStore();
    const result = await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT, TERMINAL, GIT] });

    expect(result).toEqual({ tabs: [GIT, TERMINAL], changed: true });
    expect((await store.get("s1"))?.tabs).toEqual([GIT, TERMINAL]);
  });

  it("treats rewriting the stored set as a no-op that keeps the record's age", async () => {
    const clock = { value: new Date("2026-01-01T00:00:00.000Z") };
    const store = new SessionTabsStore(undefined, () => clock.value);
    await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT] });

    clock.value = new Date("2026-06-01T00:00:00.000Z");
    const result = await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT] });

    expect(result.changed).toBe(false);
    expect((await store.get("s1"))?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("deletes the record when the tab set empties, and reports emptying a missing record as unchanged", async () => {
    const store = new SessionTabsStore();
    await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT] });

    expect(await store.set({ sessionId: "s1", cwd: "/repo", tabs: [] })).toEqual({ tabs: [], changed: true });
    expect(await store.list()).toEqual([]);
    expect(await store.set({ sessionId: "s1", cwd: "/repo", tabs: [] })).toEqual({ tabs: [], changed: false });
  });

  it("drops records for sessions that no longer exist in the reconciled cwd", async () => {
    const store = new SessionTabsStore();
    await store.set({ sessionId: "kept", cwd: "/repo", tabs: [GIT] });
    await store.set({ sessionId: "gone", cwd: "/repo", tabs: [TERMINAL] });
    await store.set({ sessionId: "elsewhere", cwd: "/other", tabs: [TERMINAL] });

    const removed = await store.reconcileCwd("/repo", ["kept"]);

    expect(removed).toEqual(["gone"]);
    expect((await store.list()).map((record) => record.sessionId).sort()).toEqual(["elsewhere", "kept"]);
  });

  it("evicts the stalest records beyond the catalog cap", async () => {
    const clock = { value: 0 };
    const store = new SessionTabsStore(undefined, () => new Date(clock.value));
    for (let index = 0; index <= SESSION_TABS_SESSION_LIMIT; index += 1) {
      clock.value = index * 1000;
      await store.set({ sessionId: `s${String(index)}`, cwd: "/repo", tabs: [GIT] });
    }

    const records = await store.list();
    expect(records).toHaveLength(SESSION_TABS_SESSION_LIMIT);
    expect(records.some((record) => record.sessionId === "s0")).toBe(false);
    expect(records.some((record) => record.sessionId === `s${String(SESSION_TABS_SESSION_LIMIT)}`)).toBe(true);
  });

  it("rejects oversized or malformed tab sets", async () => {
    const store = new SessionTabsStore();
    const oversized = Array.from({ length: SESSION_TABS_PER_SESSION_LIMIT + 1 }, (_, index) => `plugin:tool-${String(index)}`);

    await expect(store.set({ sessionId: "s1", cwd: "/repo", tabs: oversized })).rejects.toThrow("tabs exceeds its limit");
    await expect(store.set({ sessionId: "s1", cwd: "/repo", tabs: [""] })).rejects.toThrow("non-empty");
  });

  it("persists atomically and reloads from disk", async () => {
    const filePath = await tempFile();
    const store = new SessionTabsStore(filePath);
    await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT] });

    const reloaded = new SessionTabsStore(filePath);
    expect((await reloaded.get("s1"))?.tabs).toEqual([GIT]);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ sessions: [{ sessionId: "s1", tabs: [GIT] }] });
  });

  it("treats a corrupt file as empty instead of failing listings, and repairs it on the next write", async () => {
    const filePath = await tempFile();
    await writeFile(filePath, "{not json", "utf8");
    const store = new SessionTabsStore(filePath);

    expect(await store.list()).toEqual([]);
    await store.set({ sessionId: "s1", cwd: "/repo", tabs: [GIT] });
    expect((await new SessionTabsStore(filePath).get("s1"))?.tabs).toEqual([GIT]);
  });

  it("rejects duplicate ids and empty tab arrays in a parsed file", () => {
    const record = { sessionId: "s1", cwd: "/repo", tabs: [GIT], updatedAt: "2026-01-01T00:00:00.000Z" };

    expect(() => parseSessionTabsFile({ sessions: [record, record] })).toThrow("Duplicate session tabs id");
    expect(() => parseSessionTabsFile({ sessions: [{ ...record, tabs: [] }] })).toThrow("Invalid session tabs record");
  });
});
