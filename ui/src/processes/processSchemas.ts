import { z } from "zod";
import type { ManagedProcessesSnapshot, SessionUiEvent } from "@shared/apiTypes";

export const snapshotSchema = z.object({ available: z.boolean(), writeSupported: z.boolean(), processes: z.array(z.object({
  id: z.string(), name: z.string(), pid: z.number(), command: z.string(), cwd: z.string(), startTime: z.number(), endTime: z.number().nullable(),
  status: z.enum(["running", "terminating", "terminate_timeout", "exited", "killed"]), exitCode: z.number().nullable(), success: z.boolean().nullable(),
  endReason: z.enum(["exit", "signal", "spawn_error", "missing_pid", "kill_timeout", "lost"]).nullable(),
  signal: z.object({ name: z.string(), number: z.number().nullable(), description: z.string() }).nullable(), errorMessage: z.string().nullable(),
  supervision: z.enum(["systemd", "attached"]).optional(), notice: z.string().optional(),
  lastLogLine: z.object({ text: z.string(), truncatedStart: z.boolean() }).nullable().optional(),
})) }) satisfies z.ZodType<ManagedProcessesSnapshot>;

const lineNumberSchema = z.number().int().positive().safe();
const processLogLineSchema = z.object({ type: z.enum(["stdout", "stderr"]), text: z.string(),
  number: lineNumberSchema.optional(), terminated: z.boolean().optional(), truncatedStart: z.boolean().optional() });
const cursorSchema = z.object({ offset: z.number().int().nonnegative().safe(), line: lineNumberSchema });
export const processOutputBatchSchema = z.object({ lines: z.array(processLogLineSchema), cursor: cursorSchema.optional(),
  droppedLines: z.number().int().nonnegative().safe().optional() }).superRefine((batch, ctx) => {
  if (batch.cursor === undefined) return;
  let previous = 0;
  for (const line of batch.lines) {
    if (line.number === undefined) continue; // Older daemons may not send positions for every line.
    if (line.number <= previous || line.number >= batch.cursor.line) ctx.addIssue({ code: "custom", message: "Invalid managed process line order or cursor" });
    previous = line.number;
  }
});
export type ProcessesEvent = Extract<SessionUiEvent, { type: "processes.update" | "processes.output" }>;
export const processesEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("processes.update"), snapshot: snapshotSchema }),
  processOutputBatchSchema.safeExtend({ type: z.literal("processes.output"), id: z.string(), droppedLines: z.number().int().nonnegative().safe() }),
]) satisfies z.ZodType<ProcessesEvent>;
