import { z } from "zod";

/** Even JSON-escaped control characters fit below the wire-frame budget. */
const CHUNK_CHARACTERS = 32 * 1024;
export const SESSION_FRAME_BYTES = 256 * 1024;
export const SESSION_SOCKET_MAX_BYTES = 8 * 1024 * 1024;
export const SESSION_SOCKET_SEND_TIMEOUT_MS = 10_000;
const position = z.number().int().nonnegative();
const chunkSchema = z.object({
  type: z.literal("session.chunk"), id: z.string().min(1).max(128),
  index: position, total: position.positive(), data: z.string().min(1).max(CHUNK_CHARACTERS),
});

/** Split the serialized cut, not its messages. IDs, paging and watermarks stay unchanged. */
export function* sessionWireChunks(payload: string, id: string): Generator<string> {
  for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_CHARACTERS, index++) {
    yield JSON.stringify(chunkSchema.parse({ type: "session.chunk", id, index, total: payload.length, data: payload.slice(offset, offset + CHUNK_CHARACTERS) }));
  }
}

/**
 * One assembly per connection. No transcript is published until its whole cut arrives.
 * Frames and send buffers are bounded; total cut memory still scales with history.
 * Only clients requesting `chunks=1` receive these envelopes.
 */
export class SessionWireDecoder {
  private assembly: { id: string; total: number; length: number; parts: string[] } | undefined;

  clear(): void { this.assembly = undefined; }

  read(payload: string): unknown {
    const value: unknown = JSON.parse(payload);
    if (!isType(value, "session.chunk")) {
      // Host events can interleave, but serialized snapshot publishers cannot.
      if (this.assembly !== undefined && (isType(value, "session.open") || isType(value, "session.snapshot"))) {
        throw new Error("Session cut interrupted an incomplete chunked cut.");
      }
      return value;
    }
    const chunk = chunkSchema.parse(value);
    if (this.assembly === undefined) {
      if (chunk.index !== 0) throw new Error("Session chunks must start at zero.");
      this.assembly = { id: chunk.id, total: chunk.total, length: 0, parts: [] };
    }
    const assembly = this.assembly;
    if (chunk.id !== assembly.id || chunk.total !== assembly.total || chunk.index !== assembly.parts.length
      || chunk.data.length !== Math.min(CHUNK_CHARACTERS, assembly.total - assembly.length)) {
      throw new Error("Session chunk identity, order or length changed.");
    }
    assembly.parts.push(chunk.data);
    assembly.length += chunk.data.length;
    if (assembly.length < assembly.total) return undefined;
    this.clear();
    const completed: unknown = JSON.parse(assembly.parts.join(""));
    if (!isType(completed, "session.open") && !isType(completed, "session.snapshot")) throw new Error("Chunked payload is not a session cut.");
    return completed;
  }
}

function isType(value: unknown, type: string): boolean {
  return typeof value === "object" && value !== null && "type" in value && value.type === type;
}
