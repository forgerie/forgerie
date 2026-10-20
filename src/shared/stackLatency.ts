import { z } from "zod";

export const STACK_LATENCY_TRACE_HEADER = "x-forgerie-trace";
export const STACK_LATENCY_SERVER_TIMING = ["sessiond-admission", "sessiond-execute", "sessiond-serialize"] as const;
export const stackLatencyTraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/u);
export function stackLatencyTraceId(input: unknown): string | undefined {
  const parsed = stackLatencyTraceIdSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
const spanId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const stackLatencySpanSchema = z.object({
  version: z.literal(1),
  traceId: stackLatencyTraceIdSchema,
  spanId,
  parentSpanId: spanId.optional(),
  clock: z.enum(["browser", "web", "sessiond", "provider-adapter"]),
  operation: z.enum(["session-open", "session-switch", "project-context", "backlog", "process-list", "process-output", "input", "stream", "tool"]),
  phase: z.enum(["admission", "queue", "execute", "storage-read", "decode", "projection", "serialize", "transport", "commit", "paint-opportunity"]),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  outcome: z.enum(["ok", "error", "aborted"]),
  itemCount: count.optional(),
  byteCount: count.optional(),
}).strict();
export type StackLatencySpan = z.infer<typeof stackLatencySpanSchema>;
export interface StackLatencySink { record(span: StackLatencySpan): void }

/** Optional diagnostic context, never authorization or a durable execution context. */
export interface StackLatencyContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly clock: StackLatencySpan["clock"];
  readonly operation: StackLatencySpan["operation"];
  start(phase: StackLatencySpan["phase"]): (outcome?: StackLatencySpan["outcome"]) => void;
  measure<T>(phase: StackLatencySpan["phase"], run: () => Promise<T>): Promise<T>;
}
