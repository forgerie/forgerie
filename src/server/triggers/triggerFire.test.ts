import { Type } from "typebox";
import { Check } from "typebox/value";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { defaultPiSessionDir } from "../sessions/piSessionManagerGateway.js";
import { triggerSessionId } from "./triggerFire.js";

it("derives a UUIDv7 with occurrence time, sha256 entropy, version and RFC variant", () => {
  const occurrence = Date.parse("2026-10-13T03:00:00Z");
  const id = triggerSessionId("trigger-night-1", occurrence);
  const bytes = Buffer.from(id.replaceAll("-", ""), "hex");
  const hash = createHash("sha256").update("trigger-night-1").digest();
  expect(bytes.readUIntBE(0, 6)).toBe(occurrence);
  expect((bytes[6] ?? 0) >> 4).toBe(7);
  expect((bytes[8] ?? 0) >> 6).toBe(2);
  expect(bytes.subarray(9)).toEqual(hash.subarray(9, 16));
  expect(triggerSessionId("trigger-night-1", occurrence)).toBe(id);
  expect(triggerSessionId("another", occurrence)).not.toBe(id);
  expect(() => triggerSessionId("bad", -1)).toThrow("time range");
});

function child(root: string, checkpoint: string) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", new URL("./triggerRestart.testSupport.ts", import.meta.url).pathname, root, checkpoint], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  process.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  process.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  const closed = new Promise<number | null>((resolve, reject) => { process.once("error", reject); process.once("close", resolve); });
  return { process, closed, output: () => output, errors: () => errors };
}
async function stop(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => { process.once("close", () => { resolve(); }); });
  process.kill("SIGKILL");
  await closed;
}

it.each(["session", "workflow"])("SIGKILL after %s and a fresh process leave exactly one file, journal and run", async (checkpoint) => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-trigger-restart-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const children: ChildProcess[] = [];
  try {
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1", packages: [], compaction: { enabled: false } }));
    await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
    await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), "---\nworkflow:\n  version: 1\n  stages:\n    - { id: land, name: Land, stop: land }\n---\nStop at the land stage.\n");
    const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
    await projects.add({ path: cwd });
    const first = child(root, checkpoint); children.push(first.process);
    const deadline = Date.now() + 30_000;
    while (!first.output().includes(`CHECKPOINT ${checkpoint}`)) {
      if (first.process.exitCode !== null || Date.now() > deadline) throw new Error(`Checkpoint not reached: ${first.output()} ${first.errors()}`);
      await sleep(20);
    }
    const directory = defaultPiSessionDir(cwd, agentDir);
    const before = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    expect(before).toHaveLength(1); // Fixed-ID creation persists the header before any model turn.
    const header: unknown = JSON.parse((await readFile(join(directory, before[0] ?? ""), "utf8")).split("\n")[0] ?? "");
    if (!Check(Type.Object({ id: Type.String() }), header)) throw new Error("No session header");
    await stop(first.process);
    const second = child(root, "none"); children.push(second.process);
    expect(await second.closed, second.errors()).toBe(0);
    expect(second.output()).toContain('"history":1,"runs":1,"land":"waiting"');
    const line = second.output().split("\n").find((line) => line.startsWith("RESULT "));
    const result: unknown = JSON.parse(line?.slice(7) ?? "null");
    if (!Check(Type.Object({ sessionId: Type.String(), occurrence: Type.Number(), requestId: Type.String(), name: Type.String() }), result)) throw new Error("Invalid restart result");
    expect(result.sessionId).toBe(triggerSessionId(result.requestId, result.occurrence));
    expect(result.sessionId).toBe(header.id);
    expect(result.name).toBe(`Nightly refinement · ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(result.occurrence)}`);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    expect(files).toEqual(before);
    expect(files[0]).toContain(header.id);
    const journals = await readdir(join(directory, ".durable"));
    expect(journals).toEqual(files);
    const transcript = await readFile(join(directory, files[0] ?? ""), "utf8");
    expect(transcript).toContain(header.id);
  } finally { for (const process of children) await stop(process); await rm(root, { recursive: true, force: true }); }
}, 60_000);
