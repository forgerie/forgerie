import { lstat, realpath, readdir, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Storage } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { SessionBindingsSchema } from "./durableSessionBindings.js";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";
import { readDurableSessionLocator } from "./durableSessionLocator.js";
import { readSessionHeaderSummary } from "./sessionFileHeader.js";

/** Fail closed before opening a runtime or deleting anything. Never follow a stored locator for deletion. */
export async function assertEphemeralSessionFiles(root: string, file: string, sessionId: string): Promise<void> {
  if (sessionId !== basename(sessionId) || sessionId.includes("\\") || sessionId === "." || sessionId === "..") throw new Error("Invalid ephemeral session identity");
  if (dirname(resolve(file)) !== resolve(root)) throw new Error("Ephemeral transcript is outside its session folder");
  await assertOwnedPath(root, root, false);
  await assertOwnedPath(root, file, true);
  if ((await readSessionHeaderSummary(file))?.id !== sessionId) throw new Error("Ephemeral transcript has a foreign session identity");
  const paths = durableSessionPaths(file);
  const locator = await readDurableSessionLocator(paths.directory);
  if (locator !== undefined && (locator.sessionId !== sessionId || resolve(locator.databasePath) !== resolve(paths.database))) {
    throw new Error("Ephemeral journal is foreign or shared");
  }
  await assertTree(root, paths.directory);
}

async function assertOwnedPath(root: string, path: string, file: boolean): Promise<void> {
  const expected = resolve(path);
  const canonical = await realpath(path);
  if (canonical !== expected || (canonical !== resolve(root) && !canonical.startsWith(`${resolve(root)}${sep}`))) throw new Error("Ephemeral storage resolves outside its folder");
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || file && (!metadata.isFile() || metadata.nlink !== 1)) throw new Error("Ephemeral storage is linked or shared");
}
async function assertTree(root: string, directory: string): Promise<void> {
  try { await lstat(directory); } catch (error) { if (isMissing(error)) return; throw error; }
  await assertOwnedPath(root, directory, false);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await assertTree(root, path);
    else await assertOwnedPath(root, path, true);
  }
}

export async function assertEphemeralWatchFile(root: string, sessionId: string): Promise<void> {
  const file = join(root, `${sessionId}.process-watches.json`);
  if (dirname(file) !== root) throw new Error("Ephemeral process watches are outside their session folder");
  try { await lstat(file); } catch (error) { if (isMissing(error)) return; throw error; }
  await assertOwnedPath(root, file, true);
}

/** Read the binding authority through Durable's storage API; never start work to close a chat. */
export async function assertEphemeralJournalOwnership(file: string, sessionId: string): Promise<void> {
  const database = durableSessionPaths(file).database;
  const inspect = async (storage: Storage) => {
    const record = await storage.findDocument({ kind: "forgerie.session-bindings", scope: { kind: "session" } }, "current", BACKGROUND_CONTEXT);
    const value = record === undefined ? undefined : (await storage.document(record.id, "current", BACKGROUND_CONTEXT))?.value;
    if (!Check(SessionBindingsSchema, value) || Object.keys(value.sessions).length !== 1 || value.sessions[sessionId] === undefined) throw new Error("Ephemeral journal is shared or foreign");
  };
  const borrowed = await DurableSessionJournal.pool.inspectStorage(database, inspect, BACKGROUND_CONTEXT);
  if (borrowed.found) return;
  const ownership = await acquireDurableOwnership(database);
  try {
    const storage = await openNodeSqliteStorage(database);
    try { await inspect(storage); } finally { await storage.close(BACKGROUND_CONTEXT); }
  } finally { await ownership.release(); }
}

/** Call only after the runtime and its managed processes have closed and ownership was checked. */
export async function deleteEphemeralSessionFiles(root: string, file: string, sessionId: string): Promise<void> {
  await assertEphemeralSessionFiles(root, file, sessionId);
  // Keep the transcript discoverable if journal removal fails, so closing can be retried.
  await rm(durableSessionPaths(file).directory, { recursive: true, force: true });
  await unlink(file);
}
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
