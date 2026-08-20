import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionPinStore, parseSessionPinFile } from "./sessionPinStore.js";

describe("SessionPinStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pin-store-"));
    filePath = join(tempDir, "pinned-sessions.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts empty when no file exists", async () => {
    const store = new SessionPinStore(filePath);
    expect(await store.list()).toEqual([]);
    expect(await store.isPinned("s1")).toBe(false);
  });

  it("pins, persists, and survives a reload from disk", async () => {
    const store = new SessionPinStore(filePath);
    const record = await store.pin({ sessionId: "s1", cwd: "/workspace" });
    expect(record.sessionId).toBe("s1");
    expect(record.cwd).toBe("/workspace");
    expect(Date.parse(record.pinnedAt)).not.toBeNaN();

    const reloaded = new SessionPinStore(filePath);
    expect(await reloaded.isPinned("s1")).toBe(true);
    expect(await reloaded.get("s1")).toEqual(record);
  });

  it("keeps the original pinnedAt when pinning twice", async () => {
    const store = new SessionPinStore(filePath);
    const first = await store.pin({ sessionId: "s1", cwd: "/workspace" });
    const second = await store.pin({ sessionId: "s1", cwd: "/workspace" });
    expect(second).toEqual(first);
    expect(await store.list()).toHaveLength(1);
  });

  it("unpins idempotently", async () => {
    const store = new SessionPinStore(filePath);
    await store.pin({ sessionId: "s1", cwd: "/workspace" });
    expect(await store.unpin("s1")).toBe(true);
    expect(await store.unpin("s1")).toBe(false);
    expect(await store.isPinned("s1")).toBe(false);
  });

  it("resolves session id prefixes in get, but not in isPinned", async () => {
    const store = new SessionPinStore(filePath);
    await store.pin({ sessionId: "abcdef", cwd: "/workspace" });
    expect((await store.get("abc"))?.sessionId).toBe("abcdef");
    expect(await store.isPinned("abc")).toBe(false);
  });

  it("drops pins for sessions missing from their cwd, leaving other cwds alone", async () => {
    const store = new SessionPinStore(filePath);
    await store.pin({ sessionId: "kept", cwd: "/workspace" });
    await store.pin({ sessionId: "gone", cwd: "/workspace" });
    await store.pin({ sessionId: "elsewhere", cwd: "/other" });

    const removed = await store.reconcileCwd("/workspace", ["kept"]);

    expect(removed).toEqual(["gone"]);
    expect((await store.list()).map((record) => record.sessionId).sort()).toEqual(["elsewhere", "kept"]);
  });

  it("writes a well-formed file that parseSessionPinFile accepts", async () => {
    const store = new SessionPinStore(filePath);
    await store.pin({ sessionId: "s1", cwd: "/workspace" });
    const parsed = parseSessionPinFile(JSON.parse(await readFile(filePath, "utf8")));
    expect(parsed.sessions.map((record) => record.sessionId)).toEqual(["s1"]);
  });

  it("operates purely in memory when constructed without a file path", async () => {
    const store = new SessionPinStore();
    await store.pin({ sessionId: "s1", cwd: "/workspace" });
    expect(await store.isPinned("s1")).toBe(true);
    // A second store shares nothing: no file was written anywhere.
    expect(await new SessionPinStore().list()).toEqual([]);
  });

  it("rejects malformed and duplicate records on load", async () => {
    await writeFile(filePath, JSON.stringify({ sessions: [{ sessionId: "s1" }] }), "utf8");
    await expect(new SessionPinStore(filePath).list()).rejects.toThrow("Invalid pinned session record");

    expect(() => parseSessionPinFile({ sessions: [
      { sessionId: "s1", cwd: "/w", pinnedAt: "2026-08-19T00:00:00.000Z" },
      { sessionId: "s1", cwd: "/w", pinnedAt: "2026-08-19T00:00:00.000Z" },
    ] })).toThrow("Duplicate pinned session id");
  });
});
