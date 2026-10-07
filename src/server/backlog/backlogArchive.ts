import type { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import type { PiSessionServiceDependencies } from "../sessions/piSessionService.js";
import type { BacklogClaimStore } from "./backlogClaimStore.js";

/** All archive paths, including bulk cleanup, pass through this repository boundary. */
export function withBacklogClaimRelease(archive: SessionArchiveStore, claims: BacklogClaimStore): NonNullable<PiSessionServiceDependencies["archiveStore"]> {
  const releaseArchived = async () => claims.releaseSessions((await archive.list()).map((record) => record.sessionId));
  return {
    list: () => archive.list(), get: (id) => archive.get(id), isArchived: (id) => archive.isArchived(id),
    restore: (id, path) => archive.restore(id, path),
    async archive(input) {
      try { return await archive.archive(input); }
      finally { await releaseArchived(); }
    },
    async archiveMany(inputs) {
      try { return await archive.archiveMany(inputs); }
      finally { await releaseArchived(); }
    },
    async deleteArchived(id) {
      // Release before deletion removes the durable evidence of archive ownership.
      await releaseArchived();
      await archive.deleteArchived(id);
    },
    async deleteArchivedMany(ids) {
      await releaseArchived();
      return archive.deleteArchivedMany(ids);
    },
  };
}
