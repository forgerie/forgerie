import { constants } from "node:fs";
import { access, chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSessionArchiveFilePath, parseSessionArchiveFile, SessionArchiveStore } from "./sessionArchiveStore.js";

const tempRoots: string[] = [];

describe("defaultSessionArchiveFilePath", () => {
  it("uses PI_WEB_DATA_DIR when configured", () => {
    expect(defaultSessionArchiveFilePath({ PI_WEB_DATA_DIR: "managed-state" }, "/tmp/pi-web")).toBe(resolve("/tmp/pi-web", "managed-state", "archived-sessions.json"));
  });

  it("uses the ~/.forgerie default when PI_WEB_DATA_DIR is unset", () => {
    expect(defaultSessionArchiveFilePath({}, "/tmp/forgerie")).toBe(join(homedir(), ".forgerie", "archived-sessions.json"));
  });
});

describe("SessionArchiveStore", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("stores its default index and archived files under PI_WEB_DATA_DIR", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-data-dir-"));
    tempRoots.push(root);
    const dataDir = join(root, "managed-state");
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_managed.jsonl");
    await writeFile(sourcePath, "session contents\n", "utf8");
    vi.stubEnv("PI_WEB_DATA_DIR", dataDir);

    const store = new SessionArchiveStore();
    const record = await store.archive({
      sessionId: "managed",
      cwd: "/workspace",
      path: sourcePath,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:01:00.000Z",
      messageCount: 1,
      firstMessage: "hello",
    });

    const archivePath = join(dataDir, "archived-sessions", "2026-01-01_managed.jsonl");
    expect(record.archivePath).toBe(archivePath);
    await expect(readFile(archivePath, "utf8")).resolves.toBe("session contents\n");
    await expect(readFile(join(dataDir, "archived-sessions.json"), "utf8")).resolves.toContain('"sessionId": "managed"');
  });

  it("moves archived session files out of the active session directory and restores them", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_s1.jsonl");
    await writeFile(sourcePath, "session contents\n", "utf8");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), join(root, "archived-files"));
    const record = await store.archive({
      sessionId: "s1",
      cwd: "/workspace",
      path: sourcePath,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:01:00.000Z",
      messageCount: 2,
      firstMessage: "hello",
    });

    expect(await exists(sourcePath)).toBe(false);
    expect(record.originalPath).toBe(sourcePath);
    expect(record.archivePath).toBeDefined();
    if (record.archivePath === undefined) throw new Error("Expected archive path");
    expect(await readFile(record.archivePath, "utf8")).toBe("session contents\n");
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "s1", originalPath: sourcePath, archivePath: record.archivePath, messageCount: 2 }]);

    await store.restore("s1");

    expect(await readFile(sourcePath, "utf8")).toBe("session contents\n");
    expect(await exists(record.archivePath)).toBe(false);
    await expect(store.list()).resolves.toEqual([]);
    expect(parseArchiveText(await readFile(join(root, "archived-sessions.json"), "utf8")).sessions).toEqual([]);
  });

  it("permanently deletes archived session files and records", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-delete-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_s1.jsonl");
    await writeFile(sourcePath, "session contents\n", "utf8");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), join(root, "archived-files"));
    const record = await store.archive({
      sessionId: "s1",
      cwd: "/workspace",
      path: sourcePath,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:01:00.000Z",
      messageCount: 2,
      firstMessage: "hello",
    });

    if (record.archivePath === undefined) throw new Error("Expected archive path");
    await store.deleteArchived("s1");

    expect(await exists(sourcePath)).toBe(false);
    expect(await exists(record.archivePath)).toBe(false);
    await expect(store.list()).resolves.toEqual([]);
    expect(parseArchiveText(await readFile(join(root, "archived-sessions.json"), "utf8")).sessions).toEqual([]);
  });

  it("archives and permanently deletes sessions in batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-batch-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourceA = join(activeDir, "2026-01-01_a.jsonl");
    const sourceB = join(activeDir, "2026-01-01_b.jsonl");
    await writeFile(sourceA, "a\n", "utf8");
    await writeFile(sourceB, "b\n", "utf8");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), join(root, "archived-files"));
    const records = await store.archiveMany([
      {
        sessionId: "a",
        cwd: "/workspace",
        path: sourceA,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:01:00.000Z",
        messageCount: 1,
        firstMessage: "a",
      },
      {
        sessionId: "b",
        cwd: "/workspace",
        path: sourceB,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:02:00.000Z",
        messageCount: 2,
        firstMessage: "b",
      },
    ]);

    expect(records.map((record) => record.sessionId)).toEqual(["a", "b"]);
    expect(await exists(sourceA)).toBe(false);
    expect(await exists(sourceB)).toBe(false);
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "a" }, { sessionId: "b" }]);

    const archivePaths = records.map((record) => record.archivePath);
    if (archivePaths.some((path) => path === undefined)) throw new Error("Expected archive paths");
    await expect(store.deleteArchivedMany(["a", "b", "missing"])).resolves.toEqual(["a", "b"]);
    for (const archivePath of archivePaths) {
      if (archivePath === undefined) throw new Error("Expected archive path");
      expect(await exists(archivePath)).toBe(false);
    }
    await expect(store.list()).resolves.toEqual([]);
  });

  it("initializes once, caches reads, and does not rewrite an already bounded index", async () => {
    const root = await createTempRoot("pi-web-archive-cache-");
    const archiveFile = join(root, "archived-sessions.json");
    const original = `${JSON.stringify({ sessions: [archiveRecord("cached", { firstMessage: "hello" })] })}\n`;
    await writeFile(archiveFile, original, "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    const firstInitialization = store.initialize();
    expect(store.initialize()).toBe(firstInitialization);
    await expect(firstInitialization).resolves.toEqual({ status: "ready", compacted: false });
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(original);

    const unavailablePath = join(root, "archived-sessions.unavailable.json");
    await rename(archiveFile, unavailablePath);
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "cached" }]);
    await expect(store.get("cached")).resolves.toMatchObject({ sessionId: "cached" });
  });

  it("compacts legacy firstMessage metadata without changing other fields or the transcript", async () => {
    const root = await createTempRoot("pi-web-archive-compact-");
    const archiveFile = join(root, "archived-sessions.json");
    const transcriptPath = join(root, "archived-files", "legacy.jsonl");
    await mkdir(join(root, "archived-files"), { recursive: true });
    const transcript = "complete prompt remains in transcript 🎉\n";
    await writeFile(transcriptPath, transcript, "utf8");
    const oversized = `${"a".repeat(499)}🎉suffix`;
    const legacy = archiveRecord("legacy", {
      firstMessage: oversized,
      name: "Generated name",
      archivePath: transcriptPath,
      originalPath: join(root, "active", "legacy.jsonl"),
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-02T00:00:00.000Z",
      messageCount: 17,
      parentSessionPath: join(root, "parent.jsonl"),
    });
    await writeFile(archiveFile, JSON.stringify({ sessions: [legacy] }), "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await expect(store.initialize()).resolves.toEqual({ status: "ready", compacted: true });

    const [record] = parseArchiveText(await readFile(archiveFile, "utf8")).sessions;
    expect(record).toEqual({ ...legacy, firstMessage: `${"a".repeat(499)}🎉` });
    expect(Array.from(record?.firstMessage ?? "")).toHaveLength(500);
    await expect(readFile(transcriptPath, "utf8")).resolves.toBe(transcript);
    await expect(store.initialize()).resolves.toEqual({ status: "ready", compacted: true });
    const reloaded = new SessionArchiveStore(archiveFile, join(root, "archived-files"));
    await expect(reloaded.initialize()).resolves.toEqual({ status: "ready", compacted: false });
  });

  it("returns private copies of cached arrays and records", async () => {
    const root = await createTempRoot("pi-web-archive-isolation-");
    const archiveFile = join(root, "archived-sessions.json");
    await writeFile(archiveFile, JSON.stringify({
      sessions: [archiveRecord("a", { firstMessage: "first" }), archiveRecord("b", { firstMessage: "second" })],
    }), "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));
    await store.initialize();

    const returned = await store.list();
    returned.reverse();
    const first = returned[0];
    if (first === undefined) throw new Error("Expected archived record");
    first.firstMessage = "caller mutation";
    const returnedByGet = await store.get("a");
    if (returnedByGet === undefined) throw new Error("Expected archived record");
    returnedByGet.name = "caller mutation";

    const later = await store.list();
    expect(later).toMatchObject([
      { sessionId: "a", firstMessage: "first" },
      { sessionId: "b", firstMessage: "second" },
    ]);
    expect(later[0]).not.toHaveProperty("name");
  });

  it("initializes a missing index as empty without creating it", async () => {
    const root = await createTempRoot("pi-web-archive-empty-");
    const archiveFile = join(root, "state", "archived-sessions.json");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await expect(store.initialize()).resolves.toEqual({ status: "ready", compacted: false });
    await expect(store.list()).resolves.toEqual([]);
    expect(await exists(archiveFile)).toBe(false);
  });

  it("preserves malformed indexes and keeps later archive operations visibly failed", async () => {
    const root = await createTempRoot("pi-web-archive-invalid-");
    const archiveFile = join(root, "archived-sessions.json");
    const malformed = "{not-json";
    await writeFile(archiveFile, malformed, "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await expect(store.initialize()).rejects.toBeInstanceOf(SyntaxError);
    await expect(store.list()).rejects.toBeInstanceOf(SyntaxError);
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(malformed);
  });

  it("preserves invalid archive shapes and keeps later archive operations visibly failed", async () => {
    const root = await createTempRoot("pi-web-archive-invalid-shape-");
    const archiveFile = join(root, "archived-sessions.json");
    const invalid = JSON.stringify({ sessions: [{ sessionId: "missing-fields" }] });
    await writeFile(archiveFile, invalid, "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await expect(store.initialize()).rejects.toThrow("Invalid archived session record");
    await expect(store.get("missing-fields")).rejects.toThrow("Invalid archived session record");
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(invalid);
  });

  it("does not lose loaded records when a mutation starts during initialization", async () => {
    const root = await createTempRoot("pi-web-archive-initialize-mutation-");
    const archiveFile = join(root, "archived-sessions.json");
    await writeFile(archiveFile, JSON.stringify({ sessions: [archiveRecord("existing", { firstMessage: "existing" })] }), "utf8");
    const sourcePath = join(root, "active", "new.jsonl");
    await mkdir(join(root, "active"), { recursive: true });
    await writeFile(sourcePath, "new transcript\n", "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    const initialization = store.initialize();
    const archive = store.archive(archiveInput("new", sourcePath));
    await expect(initialization).resolves.toEqual({ status: "ready", compacted: false });
    await expect(archive).resolves.toMatchObject({ sessionId: "new" });

    expect((await store.list()).map((record) => record.sessionId)).toEqual(["existing", "new"]);
    const persisted = parseArchiveText(await readFile(archiveFile, "utf8"));
    expect(persisted.sessions.map((record) => record.sessionId)).toEqual(["existing", "new"]);
  });

  it.skipIf(process.platform === "win32")("continues in degraded state after startup compaction cannot be written", async () => {
    const root = await createTempRoot("pi-web-archive-degraded-");
    const indexDir = join(root, "index");
    const archiveFile = join(indexDir, "archived-sessions.json");
    await mkdir(indexDir, { recursive: true });
    const oversized = "🎉".repeat(501);
    const original = JSON.stringify({ sessions: [archiveRecord("legacy", { firstMessage: oversized })] });
    await writeFile(archiveFile, original, "utf8");
    const sourcePath = join(root, "active", "new.jsonl");
    await mkdir(join(root, "active"), { recursive: true });
    await writeFile(sourcePath, "new transcript\n", "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await chmod(indexDir, 0o500);
    try {
      const result = await store.initialize();
      expect(result.status).toBe("degraded");
      if (result.status !== "degraded") throw new Error("Expected degraded initialization");
      expect(result.compacted).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      await expect(readFile(archiveFile, "utf8")).resolves.toBe(original);
      expect(Array.from((await store.list())[0]?.firstMessage ?? "")).toHaveLength(501);
    } finally {
      await chmod(indexDir, 0o700);
    }

    await store.archive(archiveInput("new", sourcePath, "n".repeat(501)));
    const cached = await store.list();
    expect(cached.map((record) => Array.from(record.firstMessage ?? "").length)).toEqual([500, 500]);
    const persisted = parseArchiveText(await readFile(archiveFile, "utf8"));
    expect(persisted.sessions.map((record) => Array.from(record.firstMessage ?? "").length)).toEqual([500, 500]);
  });

  it.skipIf(process.platform === "win32")("keeps source and prior cache when archive index persistence fails after copying", async () => {
    const root = await createTempRoot("pi-web-archive-write-failure-");
    const indexDir = join(root, "index");
    const archiveFile = join(indexDir, "archived-sessions.json");
    await mkdir(indexDir, { recursive: true });
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));
    await store.initialize();
    const sourcePath = join(root, "active", "new.jsonl");
    await mkdir(join(root, "active"), { recursive: true });
    await writeFile(sourcePath, "new transcript\n", "utf8");

    await chmod(indexDir, 0o500);
    try {
      await expect(store.archive(archiveInput("new", sourcePath))).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(indexDir, 0o700);
    }

    expect(await exists(sourcePath)).toBe(true);
    expect(await exists(join(root, "archived-files", "new.jsonl"))).toBe(true);
    expect(await exists(archiveFile)).toBe(false);
    await expect(store.list()).resolves.toEqual([]);
  });

  it.skipIf(process.platform === "win32")("keeps prior index and cache when restore persistence fails after moving the transcript", async () => {
    const root = await createTempRoot("pi-web-archive-restore-failure-");
    const indexDir = join(root, "index");
    const archiveFile = join(indexDir, "archived-sessions.json");
    const archivePath = join(root, "archived-files", "restore.jsonl");
    const originalPath = join(root, "active", "restore.jsonl");
    await mkdir(indexDir, { recursive: true });
    await mkdir(join(root, "archived-files"), { recursive: true });
    await writeFile(archivePath, "restore transcript\n", "utf8");
    const originalIndex = JSON.stringify({ sessions: [archiveRecord("restore", { archivePath, originalPath })] });
    await writeFile(archiveFile, originalIndex, "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));
    await store.initialize();

    await chmod(indexDir, 0o500);
    try {
      await expect(store.restore("restore")).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(indexDir, 0o700);
    }

    expect(await exists(archivePath)).toBe(false);
    await expect(readFile(originalPath, "utf8")).resolves.toBe("restore transcript\n");
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(originalIndex);
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "restore" }]);
  });

  it.skipIf(process.platform === "win32")("keeps prior index and cache when delete persistence fails after removing the transcript", async () => {
    const root = await createTempRoot("pi-web-archive-delete-failure-");
    const indexDir = join(root, "index");
    const archiveFile = join(indexDir, "archived-sessions.json");
    const archivePath = join(root, "archived-files", "delete.jsonl");
    await mkdir(indexDir, { recursive: true });
    await mkdir(join(root, "archived-files"), { recursive: true });
    await writeFile(archivePath, "delete transcript\n", "utf8");
    const originalIndex = JSON.stringify({ sessions: [archiveRecord("delete", { archivePath })] });
    await writeFile(archiveFile, originalIndex, "utf8");
    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));
    await store.initialize();

    await chmod(indexDir, 0o500);
    try {
      await expect(store.deleteArchived("delete")).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(indexDir, 0o700);
    }

    expect(await exists(archivePath)).toBe(false);
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(originalIndex);
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "delete" }]);
  });

  it("prefers exact persisted session IDs over prefix matches and canonicalizes stored cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-prefix-"));
    tempRoots.push(root);
    const archiveFile = join(root, "archived-sessions.json");
    const rawCwd = join(root, "workspace", "..", "workspace");
    await writeFile(archiveFile, JSON.stringify({
      sessions: [
        {
          sessionId: "abc123",
          cwd: rawCwd,
          archivedAt: "2026-01-01T00:00:00.000Z",
          originalPath: "/sessions/abc123.jsonl",
          archivePath: "/archive/abc123.jsonl",
          messageCount: 3,
          firstMessage: "prefix",
          name: "Prefix match",
          parentSessionPath: "/sessions/root.jsonl",
        },
        {
          sessionId: "abc",
          cwd: rawCwd,
          archivedAt: "2026-01-01T00:00:00.000Z",
          originalPath: "/sessions/abc.jsonl",
          archivePath: "/archive/abc.jsonl",
          messageCount: 1,
          firstMessage: "exact",
        },
      ],
    }), "utf8");

    const store = new SessionArchiveStore(archiveFile, join(root, "archived-files"));

    await expect(store.get("abc")).resolves.toMatchObject({
      sessionId: "abc",
      cwd: resolve(rawCwd),
      firstMessage: "exact",
    });
    await expect(store.get("abc1")).resolves.toMatchObject({
      sessionId: "abc123",
      cwd: resolve(rawCwd),
      firstMessage: "prefix",
      name: "Prefix match",
      parentSessionPath: "/sessions/root.jsonl",
    });
    await expect(store.isArchived("abc1")).resolves.toBe(true);
    await expect(store.isArchived("missing")).resolves.toBe(false);
  });
});

function parseArchiveText(text: string) {
  const value: unknown = JSON.parse(text);
  return parseSessionArchiveFile(value);
}

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function archiveRecord(sessionId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId,
    cwd: "/workspace",
    archivedAt: "2026-01-03T00:00:00.000Z",
    ...overrides,
  };
}

function archiveInput(sessionId: string, path: string, firstMessage = "hello") {
  return {
    sessionId,
    cwd: "/workspace",
    path,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
