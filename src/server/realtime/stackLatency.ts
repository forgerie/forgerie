import { stackLatencySpanSchema, stackLatencyTraceIdSchema, type StackLatencyContext, type StackLatencySink, type StackLatencySpan } from "../../shared/stackLatency.js";

interface StackLatencyOptions {
  traceId: string;
  clock: StackLatencySpan["clock"];
  operation: StackLatencySpan["operation"];
  sink: StackLatencySink;
  now?: () => number;
}
interface StackLatencyDiagnostics { recorded: number; dropped: number; errors: number }
export interface StackLatencyRecording extends StackLatencyContext {
  diagnostics(): StackLatencyDiagnostics;
  dispose(): void;
}

/** Measurement-only: no timer, global registry, payload capture or default observer. */
export function createStackLatencyContext(options: StackLatencyOptions): StackLatencyRecording {
  const traceId = stackLatencyTraceIdSchema.parse(options.traceId);
  const now = options.now ?? (() => performance.now());
  const expires = now() + 300_000;
  let sink: StackLatencySink | undefined = options.sink;
  let attempts = 0;
  const counts = { recorded: 0, dropped: 0, errors: 0 };
  const start: StackLatencyContext["start"] = phase => {
    const id = ++attempts;
    let finished = false;
    let startMs: number;
    try { startMs = now(); } catch { counts.errors++; return () => { /* The failed clock already has an error receipt. */ }; }
    return (outcome = "ok") => {
      if (finished) return;
      finished = true;
      if (sink === undefined || id > 512) { counts.dropped++; return; }
      try {
        const end = now();
        if (end >= expires) { counts.dropped++; return; }
        const span = stackLatencySpanSchema.parse({ version: 1, traceId, spanId: String(id), parentSpanId: "0",
          clock: options.clock, operation: options.operation, phase, startMs, durationMs: end - startMs, outcome });
        sink.record(span);
        counts.recorded++;
      } catch { counts.errors++; }
    };
  };
  return {
    traceId, spanId: "0", clock: options.clock, operation: options.operation, start,
    async measure(phase, run) {
      const finish = start(phase);
      try { const result = await run(); finish(); return result; }
      catch (error) { finish(error instanceof Error && error.name === "AbortError" ? "aborted" : "error"); throw error; }
    },
    diagnostics: () => ({ ...counts }),
    dispose: () => { sink = undefined; },
  };
}
