import { transcriptAsks } from "./sessionAsks.testSupport.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import {
  CapturingSessionEventHub,
  fakeSessionManager,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

/**
 * Promoting is keyed by file rather than by session id, because a delegated
 * child is not open and the caller knows it only by the path its run reported.
 * A path from a request must therefore never reach a file outside the session
 * store, and must never reach one when the store is unknown.
 */

let root: string;
let outside: string;

function mkService(options: { sessionsRoot: string | undefined }): PiSessionService {
  // Built as two shapes rather than one with an optional member: under
  // exactOptionalPropertyTypes an optional method may not be present-and-undefined.
  const base = {
    create: (cwd: string) => fakeSessionManager(cwd),
    open: () => fakeSessionManager(),
    list: () => Promise.resolve([]),
    listAll: () => Promise.resolve([]),
    listParentSessionPaths: () => Promise.resolve([]),
    invalidateSessionFile: () => undefined,
    resolveSessionFile: () => Promise.resolve(undefined),
  };
  const sessionsRoot = options.sessionsRoot;
  const manager = sessionsRoot === undefined ? base : { ...base, defaultSessionsRoot: () => sessionsRoot };

  return new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: root,
    modelRuntime: testModelRuntime,
    sessionManager: manager,
    archiveStore: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      archive: () => Promise.reject(new Error("archive should not be called")),
      restore: () => Promise.resolve(),
      isArchived: () => Promise.resolve(false),
    },
    sessionAsks: transcriptAsks(),
    createAgentRuntime: () => Promise.reject(new Error("no runtime in this test")),
    heartbeatIntervalMs: 60_000,
  });
}

async function writeSessionFile(path: string, header: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify(header)}\n{"type":"message"}\n`, "utf8");
}

async function readHeader(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  const firstLine = content.slice(0, content.indexOf("\n"));
  const parsed: unknown = JSON.parse(firstLine);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Bad header");
  return { ...parsed };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-promote-root-"));
  outside = await mkdtemp(join(tmpdir(), "forgerie-promote-outside-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("promoteSpawnedSession", () => {
  it("clears the spawn marker, which returns the child to the inbox", async () => {
    const file = join(root, "child.jsonl");
    await writeSessionFile(file, { type: "session", id: "child", agentSpawned: true });

    await mkService({ sessionsRoot: root }).promoteSpawnedSession(file);

    const header = await readHeader(file);
    expect(header["agentSpawned"]).toBeUndefined();
    expect(header["id"]).toBe("child");
  });

  it("keeps the rest of the transcript", async () => {
    const file = join(root, "child.jsonl");
    await writeSessionFile(file, { type: "session", id: "child", agentSpawned: true });

    await mkService({ sessionsRoot: root }).promoteSpawnedSession(file);

    expect(await readFile(file, "utf8")).toContain('{"type":"message"}');
  });

  it("refuses a file outside the session store", async () => {
    const file = join(outside, "elsewhere.jsonl");
    await writeSessionFile(file, { type: "session", id: "other", agentSpawned: true });

    await expect(mkService({ sessionsRoot: root }).promoteSpawnedSession(file))
      .rejects.toThrow(/outside the sessions directory/);

    const header = await readHeader(file);
    expect(header["agentSpawned"]).toBe(true);
  });

  it("refuses a path that climbs out of the session store", async () => {
    const file = join(outside, "elsewhere.jsonl");
    await writeSessionFile(file, { type: "session", id: "other", agentSpawned: true });

    await expect(mkService({ sessionsRoot: root }).promoteSpawnedSession(join(root, "..", "..", file)))
      .rejects.toThrow(/outside the sessions directory/);
  });

  it("refuses everything when the session store is unknown, rather than guessing", async () => {
    const file = join(root, "child.jsonl");
    await writeSessionFile(file, { type: "session", id: "child", agentSpawned: true });

    await expect(mkService({ sessionsRoot: undefined }).promoteSpawnedSession(file))
      .rejects.toThrow(/Sessions directory is unknown/);
  });

  it("refuses a file that is not a session file", async () => {
    const file = join(root, "notes.jsonl");
    await writeFile(file, `${JSON.stringify({ type: "notes" })}\n`, "utf8");

    await expect(mkService({ sessionsRoot: root }).promoteSpawnedSession(file))
      .rejects.toThrow(/Invalid session file header/);
  });

  it("leaves a session that was never spawned by an agent untouched", async () => {
    const file = join(root, "ordinary.jsonl");
    await writeSessionFile(file, { type: "session", id: "ordinary" });

    await mkService({ sessionsRoot: root }).promoteSpawnedSession(file);

    const header = await readHeader(file);
    expect(header["id"]).toBe("ordinary");
  });
});
