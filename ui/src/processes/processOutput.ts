import type { ManagedProcessLogLine, ManagedProcessOutputBatch, ManagedProcessOutputCursor } from "@shared/apiTypes";

export const OUTPUT_TAIL_LINES = 200;
export interface ProcessOutput { lines: readonly ManagedProcessLogLine[]; cursor?: ManagedProcessOutputCursor }
type PositionedLine = ManagedProcessLogLine & { number: number };

function positioned(batch: ProcessOutput): batch is { lines: readonly PositionedLine[]; cursor: ManagedProcessOutputCursor } {
  return batch.cursor !== undefined && batch.lines.every(line => line.number !== undefined);
}

/** Undefined asks the caller to read an authoritative HTTP tail instead of guessing at line identity. */
export function reconcileProcessOutput(current: ProcessOutput | undefined, batch: ManagedProcessOutputBatch, source: "tail" | "push"): ProcessOutput | undefined {
  if (!positioned(batch)) return source === "push" ? undefined : { lines: batch.lines.slice(-OUTPUT_TAIL_LINES) };
  const retentionOnly = batch.lines.length === 0 && (batch.droppedLines ?? 0) > 0;
  if (source === "push" && current !== undefined) {
    if (!positioned(current)) return undefined;
    // An HTTP tail can be ahead of the panel's independent polling cursor.
    if (batch.cursor.offset < current.cursor.offset || (batch.cursor.offset === current.cursor.offset && !retentionOnly)) return current;
  }
  const previous = current !== undefined && positioned(current) ? current : undefined;
  const cursor = previous !== undefined && previous.cursor.offset > batch.cursor.offset ? previous.cursor : batch.cursor;
  // A tail replaces its historical range. Live lines beyond that HTTP cut survive a late response.
  const retained = previous?.lines.filter(line => source === "push" || line.number >= batch.cursor.line) ?? [];
  const byNumber = new Map(retained.map(line => [line.number, line]));
  for (const line of batch.lines) {
    const known = byNumber.get(line.number);
    // A transport-clipped delta must not replace a complete line already read from the full log.
    if (source === "push" && line.truncatedStart && known !== undefined && (!known.truncatedStart || known.text.length > line.text.length)) continue;
    byNumber.set(line.number, line);
  }
  if (source === "push" && retentionOnly) byNumber.clear();
  const lines: PositionedLine[] = [];
  // Never present a transport/retention gap as contiguous output. A later HTTP tail can fill it.
  for (let number = cursor.line - 1; lines.length < OUTPUT_TAIL_LINES; number--) {
    const line = byNumber.get(number);
    if (line === undefined) break;
    lines.push(line);
  }
  const gap = lines.length < Math.min(OUTPUT_TAIL_LINES, byNumber.size);
  // A missed push or a stale HTTP cut can leave a fillable gap. The full log, not this buffer, heals it.
  if (gap && (source === "push" || (previous !== undefined && batch.cursor.offset < previous.cursor.offset))) return undefined;
  return { lines: lines.reverse(), cursor };
}
