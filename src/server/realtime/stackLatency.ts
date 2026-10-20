import { stackLatencySpanSchema, stackLatencyTraceIdSchema, type StackLatencyContext, type StackLatencySink, type StackLatencySpan } from "../../shared/stackLatency.js";

interface StackLatencyOptions {
  traceId: string;
  clock: StackLatencySpan["clock"];
  operation: StackLatencySpan["operation"];
  sink: StackLatencySink;
  now?: () => number;
}
interface StackLatencyDiagnostics { recorded: number; dropped: number; errors: number }
type Finish = (outcome?: StackLatencySpan["outcome"]) => void;
export interface StackLatencyRecording extends StackLatencyContext {
  /** Starts a span and returns a context whose spans name it as their parent. */
  enter(phase: StackLatencySpan["phase"]): { context: StackLatencyContext; finish: Finish };
  diagnostics(): StackLatencyDiagnostics;
  dispose(): void;
}

const MAX_SPANS = 512;
const LIFETIME_MS = 300_000;

/** Measurement-only: no timer, global registry, payload capture or default observer. */
export function createStackLatencyContext(options: StackLatencyOptions): StackLatencyRecording {
  const traceId = stackLatencyTraceIdSchema.parse(options.traceId);
  const now = options.now ?? (() => performance.now());
  const expires = now() + LIFETIME_MS;
  let sink: StackLatencySink | undefined = options.sink;
  let attempts = 0;
  const counts = { recorded: 0, dropped: 0, errors: 0 };

  const begin = (phase: StackLatencySpan["phase"], parentSpanId: string): { spanId: string; finish: Finish } => {
    const id = ++attempts;
    const spanId = String(id);
    let finished = false;
    let startMs: number;
    try { startMs = now(); } catch { counts.errors++; return { spanId, finish: () => { /* The failed clock already has an error receipt. */ } }; }
    return { spanId, finish: (outcome = "ok") => {
      if (finished) return;
      finished = true;
      if (sink === undefined || id > MAX_SPANS) { counts.dropped++; return; }
      try {
        const end = now();
        if (end >= expires) { counts.dropped++; return; }
        const span = stackLatencySpanSchema.parse({ version: 1, traceId, spanId, parentSpanId,
          clock: options.clock, operation: options.operation, phase, startMs, durationMs: end - startMs, outcome });
        sink.record(span);
        counts.recorded++;
      } catch { counts.errors++; }
    } };
  };

  const context = (spanId: string): StackLatencyContext => {
    const start: StackLatencyContext["start"] = phase => begin(phase, spanId).finish;
    return {
      traceId, spanId, clock: options.clock, operation: options.operation, start,
      async measure(phase, run) {
        const finish = start(phase);
        try { const result = await run(); finish(); return result; }
        catch (error) { finish(error instanceof Error && error.name === "AbortError" ? "aborted" : "error"); throw error; }
      },
    };
  };

  return {
    ...context("0"),
    enter(phase) {
      const span = begin(phase, "0");
      return { context: context(span.spanId), finish: span.finish };
    },
    diagnostics: () => ({ ...counts }),
    dispose: () => { sink = undefined; },
  };
}
