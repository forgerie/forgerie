import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionNameIndex } from "./sessionNameIndex.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "session-name-identity-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function transcript(): Promise<string> {
  const path = join(directory, "session.jsonl");
  await writeFile(path, `${JSON.stringify({ type: "session_info", name: "Transcript name" })}\n${JSON.stringify({ type: "custom", data: "x".repeat(80 * 1024) })}\n`);
  return path;
}

describe("durable session name identity", () => {
  it("stores exact decimal identity and restores a remembered name outside the tail window", async () => {
    const path = await transcript();
    const filePath = join(directory, "index.json");
    const index = new SessionNameIndex({ filePath });
    await index.remember(path, "Remembered name");
    const state: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const stats = await stat(path, { bigint: true });
    expect(state).toMatchObject({ version: 2, entries: [{ dev: stats.dev.toString(), ino: stats.ino.toString() }] });
    expect((await new SessionNameIndex({ filePath }).namesFor([path])).get(path)).toEqual({ kind: "named", name: "Remembered name" });
  });

  it("preserves safe legacy records when a later name write upgrades the index", async () => {
    const path = await transcript();
    const filePath = join(directory, "index.json");
    const legacyPath = join(directory, "temporarily-absent.jsonl");
    await writeFile(filePath, JSON.stringify({ version: 1, entries: [{ path: legacyPath, dev: 12, ino: 34, observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Legacy name" } }] }));
    await new SessionNameIndex({ filePath }).remember(path, "New name");
    const state: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const expectedEntries: unknown = expect.arrayContaining([
      { path: legacyPath, dev: "12", ino: "34", observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Legacy name" } },
    ]);
    expect(state).toMatchObject({ version: 2, entries: expectedEntries });
  });

  it("retains safe legacy names when another legacy identity has already lost bits", async () => {
    const path = await transcript();
    const filePath = join(directory, "index.json");
    const legacyPath = join(directory, "temporarily-absent.jsonl");
    await writeFile(filePath, JSON.stringify({ version: 1, entries: [
      { path: legacyPath, dev: 12, ino: 34, observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Legacy name" } },
      { path, dev: 12, ino: Number(4035225266124021343n), observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Unsafe name" } },
    ] }));
    const errors: string[] = [];
    await new SessionNameIndex({ filePath, onPersistenceError: operation => errors.push(operation) }).remember(path, "New name");
    const state: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const expectedEntries: unknown = expect.arrayContaining([
      { path: legacyPath, dev: "12", ino: "34", observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Legacy name" } },
    ]);
    expect(state).toMatchObject({ version: 2, entries: expectedEntries });
    expect(errors).toEqual(["load"]);
  });

  it("does not trust already-rounded legacy identity as ownership of a remembered name", async () => {
    const path = join(directory, "session.jsonl");
    await writeFile(path, `${JSON.stringify({ type: "session_info", name: "Actual transcript name" })}\n`);
    const filePath = join(directory, "index.json");
    await writeFile(filePath, JSON.stringify({ version: 1, entries: [{ path, dev: 12, ino: Number(4035225266124021343n), observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Stale name" } }] }));
    const errors: string[] = [];
    const index = new SessionNameIndex({ filePath, onPersistenceError: operation => errors.push(operation) });
    expect((await index.namesFor([path])).get(path)).toEqual({ kind: "named", name: "Actual transcript name" });
    expect(errors).toEqual(["load"]);
  });

  it("rejects invalid exact identities instead of trusting a cached name", async () => {
    const path = join(directory, "session.jsonl");
    await writeFile(path, `${JSON.stringify({ type: "session_info", name: "Actual name" })}\n`);
    const filePath = join(directory, "index.json");
    for (const ino of ["-1", "01", "1.5", "18446744073709551616"]) {
      await writeFile(filePath, JSON.stringify({ version: 2, entries: [{ path, dev: "12", ino, observedSize: 100, resumeOffset: 100, name: { kind: "named", name: "Stale name" } }] }));
      const errors: string[] = [];
      const index = new SessionNameIndex({ filePath, onPersistenceError: operation => errors.push(operation) });
      expect((await index.namesFor([path])).get(path)).toEqual({ kind: "named", name: "Actual name" });
      expect(errors).toEqual(["load"]);
    }
  });
});
