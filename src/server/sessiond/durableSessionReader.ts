import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { SessionRef } from "../../shared/apiTypes.js";
import { DurableSessionJournal, durableSessionPaths } from "../sessions/durableSessionJournal.js";
import { readDurableSessionLocator } from "../sessions/durableSessionLocator.js";
import { DurableSessionReader } from "../sessions/durableSessionReader.js";
import { DurableParentReadModel } from "../sessions/durableParentReadModel.js";
import { createDurableNativeHistory, durableEntryPresentationId } from "../sessions/durableNativeHistory.js";
import type { DurableSessionAddress } from "../sessions/durableSessionAddress.js";

/** Only an execution owner may admit a native read. Inactive reads cannot pick HarnessOptions. */
export function createActiveDurableSessionReader(active: (ref: SessionRef) => {
  address: DurableSessionAddress; sessionFile: string | undefined;
} | undefined): DurableSessionReader {
  const pool = DurableSessionJournal.pool;
  return new DurableSessionReader({
    locate: async ref => {
      const owner = active(ref);
      if (owner === undefined) return undefined;
      if (owner.sessionFile !== undefined) {
        const locator = await readDurableSessionLocator(durableSessionPaths(owner.sessionFile).directory);
        if (locator?.journalId !== owner.address.journalId || locator.sessionId !== owner.address.sessionId
          || locator.databasePath !== owner.address.databasePath) throw new Error("Active Durable session locator is missing or foreign");
      }
      // The committed binding, not the discovery pointer's old conversation, selects the branch.
      return owner.address;
    },
    acquire: address => pool.acquireRead(address, context),
    readModel: handle => new DurableParentReadModel({ handle,
      messageId: (entry, index) => durableEntryPresentationId(handle.address.journalId, entry, index) }),
    history: handle => createDurableNativeHistory(handle, { acquire: (address, ctx) => pool.acquireRead(address, ctx) }),
  });
}
