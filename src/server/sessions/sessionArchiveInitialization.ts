import type { SessionArchiveInitializationResult } from "./sessionArchiveStore.js";

export interface SessionArchiveInitializationLogger {
  warn(details: { err: unknown }, message: string): void;
  error(details: { err: unknown }, message: string): void;
}

export async function initializeSessionArchive(
  initialization: Promise<SessionArchiveInitializationResult>,
  logger: SessionArchiveInitializationLogger,
): Promise<void> {
  try {
    const result = await initialization;
    if (result.status === "degraded") {
      logger.warn({ err: result.error }, "session archive index compaction failed; continuing with the disk snapshot");
    }
  } catch (error: unknown) {
    logger.error({ err: error }, "session archive index initialization failed");
  }
}
