import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertOrdinarySessionDirectory, isEphemeralSessionPath } from "./ephemeralSessions.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "ephemeral-paths-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it("uses canonical containment in the exact configured root, not a path component", async () => {
  const root = join(directory, "data", "ephemeral-sessions");
  const ordinary = join(directory, "ordinary", "ephemeral-sessions", "history");
  await mkdir(root, { recursive: true }); await mkdir(ordinary, { recursive: true });
  const ephemeral = join(root, "chat.jsonl"), normal = join(ordinary, "chat.jsonl");
  await writeFile(ephemeral, "ephemeral"); await writeFile(normal, "ordinary");
  expect(isEphemeralSessionPath(ephemeral, root)).toBe(true);
  expect(isEphemeralSessionPath(normal, root)).toBe(false);
  const outsideLink = join(root, "foreign.jsonl"); await symlink(normal, outsideLink);
  expect(isEphemeralSessionPath(outsideLink, root)).toBe(false);
  const rootLink = join(directory, "alias"); await symlink(root, rootLink);
  expect(isEphemeralSessionPath(join(rootLink, "chat.jsonl"), root)).toBe(true);
});

it("does not infer ephemeral ownership when the configured root or canonical path is unavailable", async () => {
  const root = join(directory, "ephemeral-sessions"); await mkdir(root);
  const path = join(root, "ordinary.jsonl"); await writeFile(path, "keep in archive");
  expect(isEphemeralSessionPath(path, undefined)).toBe(false);
  expect(isEphemeralSessionPath(path, join(directory, "unknown-root"))).toBe(false);
  expect(isEphemeralSessionPath(join(root, "missing.jsonl"), root)).toBe(false);
  const archive = new SessionArchiveStore(join(directory, "archives.json"));
  const record = await archive.archive({ sessionId: "ordinary", path, cwd: directory, created: "2026-10-01T00:00:00Z", modified: "2026-10-01T00:00:00Z", firstMessage: "", messageCount: 0 });
  if (record.archivePath === undefined) throw new Error("Missing ordinary archive");
  expect(await readFile(record.archivePath, "utf8")).toBe("keep in archive");
});

it("rejects canonical overlap through symlinks and missing directory descendants", async () => {
  const data = join(directory, "data"); await mkdir(data);
  const alias = join(directory, "alias"); await symlink(data, alias);
  const root = join(data, "ephemeral-sessions");
  expect(() => { assertOrdinarySessionDirectory(join(alias, "ephemeral-sessions"), root); }).toThrow(/overlap/iu);
  expect(() => { assertOrdinarySessionDirectory(join(alias, "ephemeral-sessions", "ordinary"), root); }).toThrow(/overlap/iu);
  expect(() => { assertOrdinarySessionDirectory(alias, root); }).toThrow(/overlap/iu);
  expect(() => { assertOrdinarySessionDirectory(join(data, "ephemeral-sessions-other"), root); }).not.toThrow();
});
