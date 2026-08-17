import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionCatalogScanner } from "./sessionCatalogScanner.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forgerie-session-catalog-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("SessionCatalogScanner", () => {
  it("reads bounded identity and title metadata from both ends of a large transcript", async () => {
    const sessionDir = join(tempDir, "sessions");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "2026-08-08T12-00-00-000Z_session-a.jsonl");
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "session-a", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo", parentSession: "/sessions/parent.jsonl" }),
      JSON.stringify({ type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: `Build the session inbox ${"🧪".repeat(600)}` }] } }),
      JSON.stringify({ type: "custom", customType: "large-context", data: "x".repeat(80 * 1024) }),
      JSON.stringify({ type: "session_info", name: "Renamed from the transcript tail" }),
      "",
    ];
    await writeFile(sessionFile, lines.join("\n"));

    const scanner = new SessionCatalogScanner();
    const [entry] = await scanner.scanDirectories([sessionDir]);

    expect(entry).toMatchObject({
      id: "session-a",
      cwd: "/projects/repo",
      path: sessionFile,
      name: "Renamed from the transcript tail",
      parentSessionPath: "/sessions/parent.jsonl",
    });
    expect(entry?.firstMessage.startsWith("Build the session inbox ")).toBe(true);
    expect(Array.from(entry?.firstMessage ?? "")).toHaveLength(500);
    expect(entry?.firstMessage.endsWith("🧪")).toBe(true);
    expect(entry?.created.toISOString()).toBe("2026-08-08T12:00:00.000Z");
    expect(entry?.messageCount).toBeGreaterThanOrEqual(1);
  });

  it("refreshes a memoized row after a transcript append", async () => {
    const sessionDir = join(tempDir, "sessions");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "session-b.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "session-b", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Original prompt" } }),
      "",
    ].join("\n"));
    const scanner = new SessionCatalogScanner();

    const [initial] = await scanner.scanDirectories([sessionDir]);
    expect(initial?.name).toBeUndefined();
    expect(initial?.firstMessage).toBe("Original prompt");
    await appendFile(sessionFile, `${JSON.stringify({ type: "session_info", name: "Fresh name" })}\n`);

    await expect(scanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Fresh name" }]);
  });

  it("keeps a rename after later output pushes it outside the bounded suffix", async () => {
    const sessionDir = join(tempDir, "sessions");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "session-c.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "session-c", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Original prompt" } }),
      JSON.stringify({ type: "custom", data: "x".repeat(80 * 1024) }),
      JSON.stringify({ type: "session_info", name: "Durable name" }),
      "",
    ].join("\n"));
    const scanner = new SessionCatalogScanner();

    await expect(scanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Durable name" }]);

    await appendFile(sessionFile, `${JSON.stringify({ type: "custom", data: "y".repeat(80 * 1024) })}\n`);

    await expect(scanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Durable name" }]);
  });

  it("restores renamed and cleared names from the durable index after restarts", async () => {
    const sessionDir = join(tempDir, "sessions");
    const indexFilePath = join(tempDir, "state", "session-names.json");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "session-d.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "session-d", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Original prompt" } }),
      JSON.stringify({ type: "custom", data: "x".repeat(80 * 1024) }),
      JSON.stringify({ type: "session_info", name: "First durable name" }),
      JSON.stringify({ type: "custom", data: "y".repeat(80 * 1024) }),
      "",
    ].join("\n"));

    const firstScanner = new SessionCatalogScanner({ filePath: indexFilePath });
    const [baseline] = await firstScanner.scanDirectories([sessionDir]);
    expect(baseline?.name).toBeUndefined();
    await firstScanner.rememberSessionName(sessionFile, "First durable name");
    await expect(firstScanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "First durable name" }]);
    await expect(new SessionCatalogScanner({ filePath: indexFilePath }).scanDirectories([sessionDir]))
      .resolves.toMatchObject([{ name: "First durable name" }]);

    await appendFile(sessionFile, [
      JSON.stringify({ type: "session_info", name: "Renamed while active" }),
      JSON.stringify({ type: "custom", data: "z".repeat(80 * 1024) }),
      "",
    ].join("\n"));
    const secondScanner = new SessionCatalogScanner({ filePath: indexFilePath });
    await expect(secondScanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Renamed while active" }]);
    await expect(new SessionCatalogScanner({ filePath: indexFilePath }).scanDirectories([sessionDir]))
      .resolves.toMatchObject([{ name: "Renamed while active" }]);

    await appendFile(sessionFile, [
      JSON.stringify({ type: "session_info", name: "" }),
      JSON.stringify({ type: "custom", data: "q".repeat(80 * 1024) }),
      "",
    ].join("\n"));
    const clearingScanner = new SessionCatalogScanner({ filePath: indexFilePath });
    const [cleared] = await clearingScanner.scanDirectories([sessionDir]);
    expect(cleared?.name).toBeUndefined();
    const [clearedAfterRestart] = await new SessionCatalogScanner({ filePath: indexFilePath }).scanDirectories([sessionDir]);
    expect(clearedAfterRestart?.name).toBeUndefined();
  });

  it("rebuilds a corrupt durable index without hiding sessions", async () => {
    const sessionDir = join(tempDir, "sessions");
    const indexFilePath = join(tempDir, "state", "session-names.json");
    await mkdir(sessionDir);
    await mkdir(join(tempDir, "state"));
    await writeFile(indexFilePath, "not json\n");
    const sessionFile = join(sessionDir, "session-corrupt-index.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "session-corrupt-index", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "session_info", name: "Recovered name" }),
      "",
    ].join("\n"));
    const persistenceErrors: string[] = [];

    const scanner = new SessionCatalogScanner({
      filePath: indexFilePath,
      onPersistenceError: (operation) => { persistenceErrors.push(operation); },
    });

    await expect(scanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Recovered name" }]);
    expect(persistenceErrors).toEqual(["load"]);
    await expect(new SessionCatalogScanner({ filePath: indexFilePath }).scanDirectories([sessionDir]))
      .resolves.toMatchObject([{ name: "Recovered name" }]);
  });

  it("rebuilds the durable name when a session file is replaced at the same path", async () => {
    const sessionDir = join(tempDir, "sessions");
    const indexFilePath = join(tempDir, "state", "session-names.json");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "session-e.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "session-e", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "session_info", name: "Old name" }),
      "",
    ].join("\n"));
    const scanner = new SessionCatalogScanner({ filePath: indexFilePath });
    await expect(scanner.scanDirectories([sessionDir])).resolves.toMatchObject([{ name: "Old name" }]);

    const replacement = join(sessionDir, "replacement.jsonl");
    await writeFile(replacement, [
      JSON.stringify({ type: "session", version: 3, id: "session-e", timestamp: "2026-08-08T12:00:00.000Z", cwd: "/projects/repo" }),
      JSON.stringify({ type: "custom", data: "x".repeat(80 * 1024) }),
      JSON.stringify({ type: "session_info", name: "Replacement name" }),
      "",
    ].join("\n"));
    await rename(replacement, sessionFile);

    await expect(new SessionCatalogScanner({ filePath: indexFilePath }).scanDirectories([sessionDir]))
      .resolves.toMatchObject([{ name: "Replacement name" }]);
  });
});

describe("agent-spawned marker", () => {
  it("reads the mark that keeps agent-to-agent conversations out of the inbox", async () => {
    const sessionDir = join(tempDir, "spawned");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "2026-08-10T12-00-00-000Z_spawned-a.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "spawned-a", timestamp: "2026-08-10T12:00:00.000Z", cwd: "/projects/repo", parentSession: "/sessions/owner.jsonl", agentSpawned: true }),
      JSON.stringify({ type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "do the thing" }] } }),
      "",
    ].join("\n"));

    const [entry] = await new SessionCatalogScanner().scanDirectories([sessionDir]);

    expect(entry).toMatchObject({ id: "spawned-a", agentSpawned: true });
  });

  it("leaves the mark off a session that only records a parent", async () => {
    const sessionDir = join(tempDir, "continued");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "2026-08-10T12-00-00-000Z_continued-a.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "session", version: 3, id: "continued-a", timestamp: "2026-08-10T12:00:00.000Z", cwd: "/projects/repo", parentSession: "/sessions/owner.jsonl" }),
      JSON.stringify({ type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "carry on" }] } }),
      "",
    ].join("\n"));

    const [entry] = await new SessionCatalogScanner().scanDirectories([sessionDir]);

    expect(entry?.agentSpawned).toBeUndefined();
    expect(entry?.parentSessionPath).toBe("/sessions/owner.jsonl");
  });
});
