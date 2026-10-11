import { appendFile, mkdtemp, rename, rm, stat, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionSearchIndex } from "./sessionSearchIndex.js";
import { searchEntry, writeSearchSession } from "./sessionSearch.testSupport.js";

let dir: string;
let index: SessionSearchIndex | undefined;
const logs: string[] = [];
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "search-index-")); logs.length = 0; });
afterEach(async () => { index?.close(); index = undefined; await rm(dir, { recursive: true, force: true }); });
async function openIndex(onProgress?: Parameters<typeof SessionSearchIndex.open>[0]["onProgress"]) {
  index = await SessionSearchIndex.open({ filePath: join(dir, "search.sqlite"), sessionsDir: join(dir, "sessions"), log: (line) => logs.push(line), ...(onProgress === undefined ? {} : { onProgress }) });
  return index;
}

describe("session search index lifecycle", () => {
  it("indexes all branches, requires all terms across messages, and reports the newest passage", async () => {
    await writeSearchSession(join(dir, "sessions", "one.jsonl"), "one", [
      searchEntry("root", null, "ALPHA"),
      searchEntry("old-branch", "root", "beta newer", "assistant", "2026-01-03T00:00:00.000Z"),
      searchEntry("current", "root", "beta current", "assistant", "2026-01-02T00:00:00.000Z"),
    ]);
    const store = await openIndex(); await store.scan();
    expect(store.search("alpha beta").hits).toEqual([expect.objectContaining({ sessionId: "one", offBranch: true, otherMatches: 2,  })]);
    expect(store.search("alpha beta").hits[0]?.passage.entryId).toBe("old-branch");
    expect(store.search("alpha absent").hits).toEqual([]);
    expect(store.matches("one", "beta").map((match) => match.entryId)).toEqual(["old-branch", "current"]);
  });
  it("appends incrementally and resumes incomplete lines only after their newline", async () => {
    const file = join(dir, "sessions", "one.jsonl");
    await writeSearchSession(file, "one"); const store = await openIndex(); await store.scan();
    const appended = JSON.stringify(searchEntry("second", "first", "appended needle", "assistant"));
    await appendFile(file, appended.slice(0, 40)); await store.refreshFile(file);
    expect(store.search("needle").hits).toHaveLength(0);
    await appendFile(file, appended.slice(40) + "\n"); await store.refreshFile(file);
    expect(store.search("needle").hits[0]?.passage.entryId).toBe("second");
    await store.refreshFile(file);
    expect(store.search("searchable needle").hits[0]?.otherMatches).toBe(1);
  });
  it("reindexes truncations, same-size rewrites, and replaced file identities", async () => {
    const file = join(dir, "sessions", "one.jsonl");
    await writeSearchSession(file, "one", [searchEntry("a", null, "oldterm"), searchEntry("b", "a", "long second oldterm")]);
    const store = await openIndex(); await store.scan();
    await writeSearchSession(file, "one", [searchEntry("a", null, "newterm")]); await store.refreshFile(file);
    expect(store.search("oldterm").hits).toHaveLength(0); expect(store.search("newterm").hits).toHaveLength(1);
    await writeSearchSession(file, "one", [searchEntry("a", null, "samelen")]); await store.refreshFile(file);
    expect(store.search("newterm").hits).toHaveLength(0);
    await rename(file, file + ".old"); await writeSearchSession(file, "one", [searchEntry("a", null, "replaced identity with longer text")]); await store.refreshFile(file);
    expect(store.search("samelen").hits).toHaveLength(0); expect(store.search("identity").hits).toHaveLength(1);
  });
  it("retains identity across archive moves, prunes deletion, and skips broken links and children", async () => {
    const file = join(dir, "sessions", "one.jsonl");
    await writeSearchSession(file, "one"); await writeSearchSession(join(dir, "sessions", "child.jsonl"), "child", undefined, { child: true });
    await symlink(join(dir, "missing"), join(dir, "sessions", "broken.jsonl"));
    const store = await openIndex(); await store.scan();
    expect(store.search("searchable").hits.map((hit) => hit.sessionId)).toEqual(["one"]);
    expect(logs.join("\n")).toContain("broken.jsonl");
    const archive = join(dir, "sessions", "archive.jsonl"); await rename(file, archive); await store.scan();
    expect(store.search("searchable").hits).toHaveLength(1);
    await rm(archive); await store.scan(); expect(store.search("searchable").hits).toHaveLength(0);
  });
  it.each(["schemaVersion", "extractionVersion"])("rebuilds after a %s change and creates a private database", async (version) => {
    const file = join(dir, "sessions", "one.jsonl"); await writeSearchSession(file, "one");
    const store = await openIndex(); await store.scan(); store.close(); index = undefined;
    expect((await stat(join(dir, "search.sqlite"))).mode & 0o777).toBe(0o600);
    const db = new DatabaseSync(join(dir, "search.sqlite")); db.exec(`UPDATE versions SET ${version}=0`); db.close();
    const rebuilt = await openIndex(); expect(rebuilt.search("searchable").hits).toHaveLength(0);
    await rebuilt.scan(); expect(rebuilt.search("searchable").hits).toHaveLength(1);
  });
  it("builds newest first, exposes partial hits with real counts, and skips unchanged files", async () => {
    const older = join(dir, "sessions", "old.jsonl"); const newer = join(dir, "sessions", "new.jsonl");
    await writeSearchSession(older, "old"); await writeSearchSession(newer, "new");
    await utimes(older, 1000, 1000); await utimes(newer, 2000, 2000);
    const partial: unknown[] = [];
    const store = await openIndex((status) => {
      if (status.indexedFiles === 1) partial.push(index?.search("searchable"));
    });
    await store.scan();
    expect(partial[0]).toEqual({ hits: [expect.objectContaining({ sessionId: "new" })], index: { state: "building", indexedFiles: 1, totalFiles: 2 } });
    expect(store.indexStatus()).toEqual({ state: "ready", indexedFiles: 2, totalFiles: 2 });
    // An unchanged source is not read again. Existing indexed text is retained.
    const db = new DatabaseSync(join(dir, "search.sqlite"));
    const before = db.prepare("SELECT id FROM messages ORDER BY id").all();
    await store.scan(); expect(db.prepare("SELECT id FROM messages ORDER BY id").all()).toEqual(before); db.close();
  });
  it("does not expose partial message sets or stale branch tips inside a file transaction", async () => {
    const entries = Array.from({ length: 600 }, (_, i) => searchEntry("entry-" + String(i), i === 0 ? null : "entry-" + String(i - 1), "pendingneedle " + "x".repeat(1500)));
    await writeSearchSession(join(dir, "sessions", "one.jsonl"), "one", entries);
    const store = await openIndex();
    const build = { complete: false };
    const scan = store.scan().finally(() => { build.complete = true; });
    while (!build.complete) {
      const hit = store.search("pendingneedle").hits[0];
      if (hit !== undefined) {
        expect(hit.otherMatches).toBe(599);
        expect(hit.offBranch).toBe(false);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await scan;
    expect(store.search("pendingneedle").hits[0]?.otherMatches).toBe(599);
  });

  it("updates ready counts when a new run creates a file and when it becomes a child", async () => {
    const store = await openIndex(); await store.scan();
    const file = join(dir, "sessions", "new.jsonl"); await writeSearchSession(file, "new");
    await store.refreshFile(file);
    expect(store.indexStatus()).toEqual({ state: "ready", indexedFiles: 1, totalFiles: 1 });
    await writeSearchSession(file, "new", undefined, { child: true }); await store.refreshFile(file);
    expect(store.indexStatus()).toEqual({ state: "ready", indexedFiles: 0, totalFiles: 0 });
    expect(store.search("searchable").hits).toEqual([]);
  });

  it("treats FTS operators as literal substrings", async () => {
    await writeSearchSession(join(dir, "sessions", "one.jsonl"), "one", [searchEntry("a", null, 'literal foo* NEAR(a,b) say "hello"')]);
    const store = await openIndex(); await store.scan();
    for (const query of ['foo*', 'NEAR(a,b)', '"say ""hello"""']) expect(store.search(query).hits).toHaveLength(1);
    expect(store.search("fooooo*").hits).toHaveLength(0);
  });
});
