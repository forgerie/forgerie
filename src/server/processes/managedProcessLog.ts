import { execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { atomicWrite, hasCode } from "./managedProcessFiles.js";

const execute = promisify(execFile);
const positionSchema = z.object({ offset: z.number().int().nonnegative(), line: z.number().int().positive() });
export type ManagedProcessLogCursor = z.infer<typeof positionSchema>;
const stateSchema = z.object({
  version: z.literal(1), base: positionSchema, partial: z.boolean(), read: positionSchema,
});
type LogState = z.infer<typeof stateSchema>;
export interface ManagedProcessLogReadOptions {
  maxLines?: number;
  /** Omit for the durable read position; use {offset: 0, line: 1} to browse retained output. */
  cursor?: ManagedProcessLogCursor;
}
export interface ManagedProcessLogTail {
  text: string;
  truncatedStart: boolean;
}
export interface ManagedProcessLogBatch {
  lines: { number: number; text: string; terminated: boolean; truncatedStart: boolean }[];
  cursor: ManagedProcessLogCursor;
  droppedLines: number;
}

/** The session owner serializes read, maintenance and acknowledgement calls. */
export class ManagedProcessLog {
  constructor(private readonly directory: string, private readonly capBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(capBytes) || capBytes < 1) throw new Error("Invalid managed process log cap");
  }
  async read(ended: boolean, options: ManagedProcessLogReadOptions = {}): Promise<ManagedProcessLogBatch> {
    const maxLines = options.maxLines ?? 1000;
    if (!Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 10_000) throw new Error("Invalid managed process log batch size");
    const state = await this.maintain();
    const position = options.cursor === undefined ? state.read : positionSchema.parse(options.cursor);
    const file = await open(join(this.directory, "output.log"), "r");
    try {
      const size = Math.min((await file.stat()).size, state.base.offset + this.capBytes);
      if (position.offset > size) throw new Error("Managed process log cursor is beyond output");
      let offset = Math.max(position.offset, state.base.offset);
      let line = position.offset < state.base.offset ? state.base.line : position.line;
      let truncatedStart = offset === state.base.offset && state.partial;
      // One snapshot per call. Appends after this size belong to the next call.
      const buffer = Buffer.alloc(Math.min(64 * 1024, size - offset));
      const lines: ManagedProcessLogBatch["lines"] = [];
      let readOffset = offset;
      let fragments: Buffer[] = [];
      let fragmentBytes = 0;
      while (readOffset < size && lines.length < maxLines) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - readOffset), readOffset);
        if (bytesRead === 0) throw new Error("Managed process log shrank while reading");
        let start = 0;
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] !== 10) continue;
          const tail = buffer.subarray(start, index);
          // Decode only complete lines: a chunk can split a UTF-8 code point.
          const text = fragments.length === 0 ? tail.toString("utf8") : Buffer.concat([...fragments, tail], fragmentBytes + tail.length).toString("utf8");
          lines.push({ number: line++, text, terminated: true, truncatedStart });
          fragments = []; fragmentBytes = 0;
          truncatedStart = false; start = index + 1;
          offset = readOffset + start;
          if (lines.length === maxLines) break;
        }
        if (lines.length < maxLines && start < bytesRead) {
          // The read buffer is reused. Retain only the unfinished line, not
          // the rest of the log; concatenate once, rather than on each chunk.
          const fragment = Buffer.from(buffer.subarray(start, bytesRead));
          fragments.push(fragment); fragmentBytes += fragment.length;
        }
        readOffset += bytesRead;
      }
      if (ended && lines.length < maxLines && fragmentBytes > 0) {
        lines.push({ number: line++, text: Buffer.concat(fragments, fragmentBytes).toString("utf8"), terminated: false, truncatedStart });
        offset = readOffset;
      }
      return { lines, cursor: { offset, line }, droppedLines: Math.max(0, state.base.line - position.line) };
    } finally { await file.close(); }
  }
  /** A bounded live preview, including unfinished output. Never retains or acknowledges logs. */
  async tail(): Promise<ManagedProcessLogTail | null> {
    const state = await this.load();
    const file = await open(join(this.directory, "output.log"), "r");
    try {
      const size = (await file.stat()).size;
      if (size < state.base.offset || size < state.read.offset) throw new Error("Managed process log was externally truncated");
      const base = Math.max(state.base.offset, size - this.capBytes);
      if (size === base) return null;
      // Allow a trailing newline and the preceding byte to identify a complete 4 KiB line.
      const start = Math.max(state.base.offset, base - 1, size - 4098);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      if (bytesRead !== buffer.length) throw new Error("Managed process log shrank while reading");
      const end = buffer[buffer.length - 1] === 10 ? buffer.length - 1 : buffer.length;
      const newline = end === 0 ? -1 : buffer.lastIndexOf(10, end - 1);
      let from = Math.max(newline + 1, end - 4096, base - start);
      const truncatedStart = from > 0 ? buffer[from - 1] !== 10 : start > state.base.offset || state.partial;
      // A suffix can start inside a code point. Skip its continuation bytes.
      if (truncatedStart) {
        while (from < end) {
          const byte = buffer[from];
          if (byte === undefined || (byte & 0xc0) !== 0x80) break;
          from++;
        }
      }
      return { text: new TextDecoder().decode(buffer.subarray(from, end), { stream: true }), truncatedStart };
    } finally { await file.close(); }
  }
  async acknowledge(cursor: ManagedProcessLogCursor): Promise<void> {
    positionSchema.parse(cursor);
    const state = await this.load();
    const file = await open(join(this.directory, "output.log"), "r");
    try {
      if (cursor.offset > (await file.stat()).size || cursor.offset < state.read.offset || cursor.line < state.read.line) throw new Error("Invalid managed process log acknowledgement");
    } finally { await file.close(); }
    state.read = cursor;
    await this.save(state);
  }
  async maintain(): Promise<LogState> {
    const state = await this.load();
    const path = join(this.directory, "output.log");
    const file = await open(path, "r");
    try {
      const size = (await file.stat()).size;
      if (size < state.base.offset || size < state.read.offset) throw new Error("Managed process log was externally truncated");
      const cutoff = Math.max(state.base.offset, size - this.capBytes);
      const buffer = Buffer.alloc(64 * 1024);
      while (state.base.offset < cutoff) {
        const length = Math.min(buffer.length, cutoff - state.base.offset);
        const { bytesRead } = await file.read(buffer, 0, length, state.base.offset);
        if (bytesRead === 0) throw new Error("Managed process log shrank during retention");
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] === 10) state.base.line++;
        }
        state.partial = buffer[bytesRead - 1] !== 10;
        state.base.offset += bytesRead;
      }
      if (state.base.offset > 0) {
        // NEVER rename, copy-truncate or shift this file: systemd holds O_APPEND
        // descriptors on its inode and can write while retention runs. Instead
        // keep absolute byte offsets and punch a sparse prefix with KEEP_SIZE.
        // Count its newlines BEFORE punching; persist the new base first. A crash
        // between publish and punch only leaves extra disk blocks, and the next
        // pass retries the punch. Writers append beyond the sampled EOF, so no
        // byte they append can move, be overwritten, or disappear in this step.
        // A cut mid-line retains that line's number and marks its surviving tail
        // truncated. Unterminated lines are emitted only after the process ends.
        // Logical size grows; allocated storage is cap + up to two FS blocks.
        await this.save(state);
        await execute("fallocate", ["--punch-hole", "--keep-size", "--offset", "0", "--length", String(state.base.offset), path], { timeout: 30_000 });
      }
      return state;
    } finally { await file.close(); }
  }
  private async load(): Promise<LogState> {
    try { return stateSchema.parse(JSON.parse(await readFile(join(this.directory, "read-position.json"), "utf8"))); }
    catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      return { version: 1, base: { offset: 0, line: 1 }, partial: false, read: { offset: 0, line: 1 } };
    }
  }
  private save(state: LogState): Promise<void> { return atomicWrite(join(this.directory, "read-position.json"), JSON.stringify(state)); }
}
