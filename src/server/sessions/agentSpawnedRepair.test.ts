import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairAgentSpawnedMarks } from "./agentSpawnedRepair.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-spawned-repair-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Sessions live one level down, under a directory per project. */
async function writeSession(project: string, name: string, lines: readonly unknown[]): Promise<string> {
  const dir = join(root, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
  const past = new Date(Date.now() - 3_600_000);
  await utimes(path, past, past);
  return path;
}

function spawnResult(...sessionFiles: readonly string[]): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "subagent",
      details: { results: sessionFiles.map((sessionFile) => ({ agent: "scout", sessionFile })) },
    },
  };
}

async function isMarked(path: string): Promise<boolean> {
  const content = await readFile(path, "utf8");
  return content.slice(0, content.indexOf("\n")).includes('"agentSpawned":true');
}

describe("repairAgentSpawnedMarks", () => {
  it("marks a child the daemon never witnessed, using the parent's own transcript", async () => {
    const child = await writeSession("repo", "child.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/repo" }]);
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    const report = await repairAgentSpawnedMarks(root);

    expect(await isMarked(child)).toBe(true);
    expect(report).toMatchObject({ marked: 1, already: 0 });
  });

  it("finds a child whose parent file was renamed, since the rename still names it", async () => {
    const child = await writeSession("repo", "child.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/repo", parentSession: join(root, "repo", "gone.jsonl") }]);
    await writeSession("repo", "parent-recovered.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    await repairAgentSpawnedMarks(root);

    expect(await isMarked(child)).toBe(true);
  });

  it("crosses project directories, because a child can be spawned into another workspace", async () => {
    const child = await writeSession("other", "child.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/other" }]);
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    await repairAgentSpawnedMarks(root);

    expect(await isMarked(child)).toBe(true);
  });

  it("leaves an ordinary session alone", async () => {
    const ordinary = await writeSession("repo", "ordinary.jsonl", [{ type: "session", version: 3, id: "ordinary", cwd: "/repo" }]);
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }]);

    const report = await repairAgentSpawnedMarks(root);

    expect(await isMarked(ordinary)).toBe(false);
    expect(report).toMatchObject({ marked: 0 });
  });

  it("counts an already-marked child without rewriting it", async () => {
    const child = await writeSession("repo", "child.jsonl", [{ type: "session", version: 3, id: "child", agentSpawned: true }]);
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    const report = await repairAgentSpawnedMarks(root);

    expect(report).toMatchObject({ marked: 0, already: 1 });
  });

  it("skips a child that is still being written and reports it as busy", async () => {
    const dir = join(root, "repo");
    await mkdir(dir, { recursive: true });
    const child = join(dir, "live.jsonl");
    await writeFile(child, `${JSON.stringify({ type: "session", version: 3, id: "live", cwd: "/repo" })}\n`, "utf8");
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    const report = await repairAgentSpawnedMarks(root);

    expect(await isMarked(child)).toBe(false);
    expect(report).toMatchObject({ marked: 0, busy: 1 });
  });

  it("counts a named child whose file is gone without failing the sweep", async () => {
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(join(root, "repo", "deleted.jsonl"))]);

    const report = await repairAgentSpawnedMarks(root);

    expect(report).toMatchObject({ marked: 0, absent: 1 });
  });

  it("reads each unchanged transcript once across sweeps", async () => {
    const child = await writeSession("repo", "child.jsonl", [{ type: "session", version: 3, id: "child", cwd: "/repo" }]);
    await writeSession("repo", "parent.jsonl", [{ type: "session", version: 3, id: "parent", cwd: "/repo" }, spawnResult(child)]);

    const first = await repairAgentSpawnedMarks(root);
    const second = await repairAgentSpawnedMarks(root, { memo: undefined });
    const shared = new Map();
    const third = await repairAgentSpawnedMarks(root, { memo: shared });
    const fourth = await repairAgentSpawnedMarks(root, { memo: shared });

    expect(first.scanned).toBe(2);
    expect(second.scanned).toBe(2);
    expect(third.scanned).toBe(2);
    expect(fourth.scanned).toBe(0);
  });

  it("reports nothing for a sessions root that does not exist", async () => {
    const report = await repairAgentSpawnedMarks(join(root, "nowhere"));

    expect(report).toMatchObject({ scanned: 0, marked: 0 });
  });
});
