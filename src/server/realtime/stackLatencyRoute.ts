import type { FastifyRequest, RouteShorthandOptions } from "fastify";
import { STACK_LATENCY_SERVER_TIMING, STACK_LATENCY_TRACE_HEADER, stackLatencyTraceId, type StackLatencyContext, type StackLatencySink, type StackLatencySpan } from "../../shared/stackLatency.js";
import { createStackLatencyContext, type StackLatencyRecording } from "./stackLatency.js";

type Finish = (outcome?: StackLatencySpan["outcome"]) => void;
interface RouteTrace { recording: StackLatencyRecording; admission: Finish; serialize?: Finish; timings: [string, number][] }
const serverTimingNames: ReadonlySet<string> = new Set(STACK_LATENCY_SERVER_TIMING);

/**
 * Opt-in daemon spans for one route. Without an injected sink this returns no hooks,
 * so a client header alone never enables recording. The trace ID never authorizes.
 */
export function stackLatencyRoute(sink: StackLatencySink | undefined, operation: StackLatencySpan["operation"]) {
  const traces = new WeakMap<FastifyRequest, RouteTrace>();
  const hooks: RouteShorthandOptions = sink === undefined ? {} : {
    onRequest: (request, _reply, done) => {
      const traceId = stackLatencyTraceId(request.headers[STACK_LATENCY_TRACE_HEADER]);
      if (traceId !== undefined) {
        const timings: [string, number][] = [];
        const recording = createStackLatencyContext({ traceId, clock: "sessiond", operation, sink: { record(span) {
          // Only top-level request phases become headers; nested spans are not additive.
          const name = `sessiond-${span.phase}`;
          if (span.parentSpanId === "0" && serverTimingNames.has(name)) timings.push([name, span.durationMs]);
          sink.record(span);
        } } });
        traces.set(request, { recording, admission: recording.start("admission"), timings });
      }
      done();
    },
    preSerialization: (request, _reply, payload, done) => {
      const trace = traces.get(request);
      if (trace !== undefined) trace.serialize = trace.recording.start("serialize");
      done(null, payload);
    },
    onSend: (request, reply, payload, done) => {
      const trace = traces.get(request);
      if (trace !== undefined) {
        trace.serialize?.(reply.statusCode < 400 ? "ok" : "error");
        if (trace.timings.length > 0) reply.header("server-timing", trace.timings.map(([name, duration]) => `${name};dur=${duration.toFixed(2)}`).join(", "));
      }
      done(null, payload);
    },
    onResponse: (request, _reply, done) => {
      traces.get(request)?.recording.dispose();
      traces.delete(request);
      done();
    },
  };
  return {
    hooks,
    /** Ends admission and starts execution; undefined when this request is not measured. */
    execute(request: FastifyRequest): { context: StackLatencyContext; finish: Finish } | undefined {
      const trace = traces.get(request);
      if (trace === undefined) return undefined;
      trace.admission();
      return trace.recording.enter("execute");
    },
  };
}
