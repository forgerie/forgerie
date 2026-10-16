import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationId, Storage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Check } from "typebox/value";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";
import { readDurableSessionLocator } from "./durableSessionLocator.js";
import { SessionBindingsSchema, boundConversationId } from "./durableSessionBindings.js";
import { readChildDocument } from "./durableChildStorageReads.js";

/** A saved-child read borrows owned storage or takes its lock. It never creates a Harness or resumes/imports work. */
export async function readSavedChild<T>(sessionFile: string, sessionId: string, read: (storage: Storage, parent: ConversationId) => Promise<T>): Promise<T> {
  const address = await readDurableSessionLocator(durableSessionPaths(sessionFile).directory);
  if (address === undefined) throw new Error("This session does not host child agents");
  if (address.sessionId !== sessionId) throw new Error("Foreign saved child session locator");
  const inspect = async (storage: Storage) => {
    const bindings = await readChildDocument(storage, "forgerie.session-bindings", undefined, context);
    if (!Check(SessionBindingsSchema, bindings) || bindings.journalId !== address.journalId) throw new Error("Invalid or foreign saved child session bindings");
    const binding = bindings.sessions[sessionId];
    if (binding?.retained.includes(binding.conversationId) !== true) throw new Error("Saved child locator has no matching session binding");
    const parent = boundConversationId(binding.conversationId);
    if (await storage.conversation(parent, context) === undefined) throw new Error("Saved child parent conversation is missing");
    return read(storage, parent);
  };
  const borrowed = await DurableSessionJournal.pool.inspectStorage(address.databasePath, inspect, context);
  if (borrowed.found) return borrowed.value;
  await stat(address.databasePath); // Opening a missing SQLite file would create a new journal.
  const ownership = await acquireDurableOwnership(address.databasePath);
  let storage: Storage | undefined;
  try {
    await stat(ownership.databasePath);
    ownership.assertOwned();
    storage = await openNodeSqliteStorage(ownership.databasePath);
    return await inspect(storage);
  } finally {
    try { await storage?.close(context); }
    finally { await ownership.release(); }
  }
}
