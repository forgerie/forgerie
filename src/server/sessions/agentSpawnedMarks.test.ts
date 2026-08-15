import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markAgentSpawned, readSpawnedSessionPaths } from "./agentSpawnedMarks.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-spawned-marks-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSession(name: string, lines: readonly unknown[]): Promise<string> {
  const path = join(root, name);
  await writeFile(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
  return path;
}

/** Backdate a file so the quiet-period guard treats it as no longer being written. */
async function makeQuiet(path: string): Promise<void> {
  const past = new Date(Date.now() - 3_600_000);
  await utimes(path, past, past);
}

async function header(path: string): Promise<object> {
  const content = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(content.slice(0, content.indexOf("\n")));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`not an object header: ${path}`);
  return parsed;
}

describe("readSpawnedSessionPaths", () => {
  it("collects every session file a transcript's tool results name", async () => {
    const path = await writeSession("parent.jsonl", [
      { type: "session", version: 3, id: "parent", cwd: "/repo" },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "subagent",
          details: { results: [{ agent: "scout", sessionFile: "/sessions/a.jsonl" }, { agent: "scout", sessionFile: "/sessions/b.jsonl" }] },
        },
      },
      { type: "message", message: { role: "toolResult", toolName: "read", details: {} } },
    ]);

    await expect(readSpawnedSessionPaths(path)).resolves.toEqual(new Set(["/sessions/a.jsonl", "/sessions/b.jsonl"]));
  });

  it("reads paths that contain escaped characters without throwing", async () => {
    const path = await writeSession("escaped.jsonl", [
      { type: "session", version: 3, id: "parent", cwd: "/repo" },
      { type: "message", message: { role: "toolResult", details: { results: [{ sessionFile: "/sessions/with \"quote\"/c.jsonl" }] } } },
    ]);

    await expect(readSpawnedSessionPaths(path)).resolves.toEqual(new Set(['/sessions/with "quote"/c.jsonl']));
  });

  it("returns nothing for a transcript that names no spawned session", async () => {
    const path = await writeSession("quiet.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }]);

    await expect(readSpawnedSessionPaths(path)).resolves.toEqual(new Set());
  });

  it("reports an unreadable transcript as naming nothing rather than throwing", async () => {
    await expect(readSpawnedSessionPaths(join(root, "missing.jsonl"))).resolves.toEqual(new Set());
  });
});

describe("markAgentSpawned", () => {
  it("writes the mark into the header and leaves every later line byte-identical", async () => {
    const path = await writeSession("child.jsonl", [
      { type: "session", version: 3, id: "child", cwd: "/repo" },
      { type: "message", message: { role: "user", content: "one" } },
      { type: "message", message: { role: "assistant", content: "two" } },
    ]);
    const before = await readFile(path, "utf8");
    await makeQuiet(path);

    await expect(markAgentSpawned(path)).resolves.toEqual({ kind: "marked" });

    expect(await header(path)).toMatchObject({ id: "child", agentSpawned: true });
    const after = await readFile(path, "utf8");
    expect(after.slice(after.indexOf("\n"))).toBe(before.slice(before.indexOf("\n")));
  });

  it("reports an already-marked session without rewriting it", async () => {
    const path = await writeSession("marked.jsonl", [{ type: "session", version: 3, id: "child", agentSpawned: true }]);
    await makeQuiet(path);
    const before = await stat(path);

    await expect(markAgentSpawned(path)).resolves.toEqual({ kind: "already" });

    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it("refuses to rewrite a session that is still being appended to", async () => {
    const path = await writeSession("live.jsonl", [
      { type: "session", version: 3, id: "live", cwd: "/repo" },
      { type: "message", message: { role: "user", content: "still typing" } },
    ]);
    const before = await readFile(path, "utf8");

    await expect(markAgentSpawned(path)).resolves.toEqual({ kind: "busy" });

    expect(await readFile(path, "utf8")).toBe(before);
    expect(await header(path)).not.toHaveProperty("agentSpawned");
  });

  it("marks a live session when the caller knows the writer has exited", async () => {
    const path = await writeSession("just-finished.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/repo" }]);

    await expect(markAgentSpawned(path, { requireQuietForMs: 0 })).resolves.toEqual({ kind: "marked" });

    expect(await header(path)).toMatchObject({ agentSpawned: true });
  });

  it("abandons the rewrite when the file grows while it is being read", async () => {
    const path = await writeSession("racing.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/repo" }]);
    await makeQuiet(path);
    const before = await readFile(path, "utf8");

    const outcome = await markAgentSpawned(path, {
      requireQuietForMs: 0,
      onBeforeWrite: async () => { await writeFile(path, `${before}${JSON.stringify({ type: "message" })}\n`, "utf8"); },
    });

    expect(outcome).toEqual({ kind: "busy" });
    expect(await readFile(path, "utf8")).toContain('{"type":"message"}');
    expect(await header(path)).not.toHaveProperty("agentSpawned");
  });

  it("reports a session file that is gone", async () => {
    await expect(markAgentSpawned(join(root, "gone.jsonl"))).resolves.toEqual({ kind: "absent" });
  });

  it("refuses a file whose first line is not a session header", async () => {
    const path = await writeSession("notes.jsonl", [{ type: "notes" }]);
    await makeQuiet(path);

    await expect(markAgentSpawned(path)).resolves.toEqual({ kind: "not-a-session" });
    expect(await header(path)).toEqual({ type: "notes" });
  });
});
