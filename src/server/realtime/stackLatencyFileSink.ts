import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { stackLatencySpanSchema, type StackLatencySink } from "../../shared/stackLatency.js";

const STACK_LATENCY_FILE_ENV = "PI_WEB_STACK_LATENCY_FILE";
const DEFAULT_MAX_PENDING = 4096;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export interface StackLatencyFileSink extends StackLatencySink {
  diagnostics(): { written: number; dropped: number; errors: number };
  close(): Promise<void>;
}

/**
 * A measurement switch for temporary profiles, never a production setting.
 * Unset means no sink: routes install no hooks and nothing opens at startup.
 * Recording only queues a validated line. A later unawaited append writes it, so a
 * slow or failing file never delays or fails a product response. The file is opened
 * without following a symlink, created owner-only, and capped in bytes; overflow is
 * dropped and counted.
 */
export function stackLatencyFileSinkFromEnvironment(env: Readonly<NodeJS.ProcessEnv>, options: { maxPending?: number; maxBytes?: number } = {}): StackLatencyFileSink | undefined {
  const path = env[STACK_LATENCY_FILE_ENV];
  if (path === undefined || path === "") return undefined;
  if (!isAbsolute(path)) throw new Error(`${STACK_LATENCY_FILE_ENV} must be an absolute path`);
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const counts = { written: 0, dropped: 0, errors: 0 };
  let reservedBytes = 0;
  let pending: string[] = [];
  let file: Promise<FileHandle> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let scheduled = false;
  let closed = false;
  const handle = () => file ??= open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    .then(async opened => {
      if (!(await opened.stat()).isFile()) { await opened.close(); throw new Error(`${STACK_LATENCY_FILE_ENV} is not a regular file`); }
      return opened;
    });
  const flush = () => {
    scheduled = false;
    const lines = pending;
    pending = [];
    if (lines.length === 0) return;
    writing = writing.then(async () => { await (await handle()).write(lines.join("")); })
      .then(() => { counts.written += lines.length; }, () => { counts.errors++; });
  };
  return {
    record(span) {
      const line = `${JSON.stringify(stackLatencySpanSchema.parse(span))}\n`;
      const bytes = Buffer.byteLength(line);
      if (closed || pending.length >= maxPending || reservedBytes + bytes > maxBytes) { counts.dropped++; return; }
      reservedBytes += bytes;
      pending.push(line);
      if (!scheduled) { scheduled = true; setImmediate(flush); }
    },
    diagnostics: () => ({ ...counts }),
    async close() {
      closed = true;
      flush();
      await writing;
      await file?.then(opened => opened.close(), () => undefined);
    },
  };
}
