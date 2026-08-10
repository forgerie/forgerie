import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
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
