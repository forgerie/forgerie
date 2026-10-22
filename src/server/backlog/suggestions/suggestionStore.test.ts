import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { BacklogSuggestionStore } from "./suggestionStore.js";
import { suggestion } from "./suggestionTestSupport.js";

describe("backlog suggestion store", () => {
  it("publishes private atomic records and durable request results without exposing mutable references", async () => {
    const root = await mkdtemp(join(tmpdir(), "suggestions-store-"));
    try {
      const path = join(root, "data/backlog-suggestions.json"); const events: string[] = [];
      const store = new BacklogSuggestionStore(path, record => events.push(record.state.kind)); await store.initialize();
      const created = await store.create(suggestion()); created.title = "not saved";
      const next = await store.update({ ...store.require(created.id), state: { kind: "dismissed", at: "now" } }, { suggestionId: created.id, requestId: "click", fingerprint: "fp", result: created });
      expect(next.revision).toBe(2); expect(events).toEqual(["open", "dismissed"]);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      const reopened = new BacklogSuggestionStore(path); await reopened.initialize();
      expect(reopened.list()).toEqual(store.list()); expect(reopened.receipt(created.id, "click")?.result?.state.kind).toBe("dismissed");
      expect(store.require(created.id).title).toBe("Improve launch recovery");
      await expect(store.update(suggestion())).rejects.toThrow("changed");
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("fails closed on damaged storage and marks interrupted filing as unsafe to replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "suggestions-store-")); const path = join(root, "records.json");
    try {
      const store = new BacklogSuggestionStore(path); await store.create(suggestion({ state: { kind: "filing", action: "file" } }));
      const reopened = new BacklogSuggestionStore(path); await reopened.initialize();
      expect(reopened.require("suggestion").state).toMatchObject({ kind: "failed", retryable: false });
      await writeFile(path, "private broken data");
      await expect(new BacklogSuggestionStore(path).initialize()).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe("private broken data");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
