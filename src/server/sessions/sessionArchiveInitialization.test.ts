import { describe, expect, it } from "vitest";
import {
  initializeSessionArchive,
  type SessionArchiveInitializationLogger,
} from "./sessionArchiveInitialization.js";
import type { SessionArchiveInitializationResult } from "./sessionArchiveStore.js";

interface LogEntry {
  level: "warn" | "error";
  details: { err: unknown };
  message: string;
}

function recordingLogger(): { entries: LogEntry[]; logger: SessionArchiveInitializationLogger } {
  const entries: LogEntry[] = [];
  return {
    entries,
    logger: {
      warn(details, message) {
        entries.push({ level: "warn", details, message });
      },
      error(details, message) {
        entries.push({ level: "error", details, message });
      },
    },
  };
}

describe("initializeSessionArchive", () => {
  it("continues silently when the archive is ready", async () => {
    const { entries, logger } = recordingLogger();
    const result: SessionArchiveInitializationResult = { status: "ready", compacted: false };

    await expect(initializeSessionArchive(Promise.resolve(result), logger)).resolves.toBeUndefined();

    expect(entries).toEqual([]);
  });

  it("warns and continues when archive compaction is degraded", async () => {
    const { entries, logger } = recordingLogger();
    const error = new Error("index is read-only");
    const result: SessionArchiveInitializationResult = { status: "degraded", compacted: false, error };

    await expect(initializeSessionArchive(Promise.resolve(result), logger)).resolves.toBeUndefined();

    expect(entries).toEqual([{
      level: "warn",
      details: { err: error },
      message: "session archive index compaction failed; continuing with the disk snapshot",
    }]);
  });

  it("logs and continues when archive parsing rejects", async () => {
    const { entries, logger } = recordingLogger();
    const error = new SyntaxError("Unexpected token");

    await expect(initializeSessionArchive(Promise.reject(error), logger)).resolves.toBeUndefined();

    expect(entries).toEqual([{
      level: "error",
      details: { err: error },
      message: "session archive index initialization failed",
    }]);
  });
});
