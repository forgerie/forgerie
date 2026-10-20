import { describe, expect, it } from "vitest";
import { stackLatencySpanSchema, type StackLatencySpan } from "../../shared/stackLatency.js";
import { createStackLatencyContext } from "./stackLatency.js";

const traceId = "a".repeat(32);
describe("bounded optional stack latency observer", () => {
  it("measures actual boundaries and strips no private fields into accepted spans", async () => {
    let now = 10;
    const spans: StackLatencySpan[] = [];
    const context = createStackLatencyContext({ traceId, clock: "sessiond", operation: "session-open", sink: { record: span => { spans.push(span); } }, now: () => now });
    const result = await context.measure("admission", () => { now = 25; return Promise.resolve("original"); });
    expect(result).toBe("original");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ traceId, phase: "admission", startMs: 10, durationMs: 15, outcome: "ok" });
    expect(stackLatencySpanSchema.safeParse({ ...spans[0], path: "/private" }).success).toBe(false);
    expect(stackLatencySpanSchema.safeParse({ ...spans[0], durationMs: Infinity }).success).toBe(false);
    expect(stackLatencySpanSchema.safeParse({ ...spans[0], traceId: "session-id" }).success).toBe(false);
  });
  it("links nested phase spans to the enclosing span without summing them", async () => {
    const spans: StackLatencySpan[] = [];
    const root = createStackLatencyContext({ traceId, clock: "sessiond", operation: "session-open", sink: { record: span => { spans.push(span); } } });
    const execute = root.enter("execute");
    await execute.context.measure("storage-read", () => Promise.resolve());
    execute.finish();
    const [child, parent] = spans;
    expect(parent).toMatchObject({ phase: "execute", parentSpanId: "0" });
    expect(child).toMatchObject({ phase: "storage-read", parentSpanId: parent?.spanId });
    expect(execute.context.spanId).toBe(parent?.spanId);
  });
  it("retains the original result and rejection when a sink throws", async () => {
    const context = createStackLatencyContext({ traceId, clock: "sessiond", operation: "session-open", sink: { record: () => { throw new Error("observer"); } } });
    expect(await context.measure("execute", () => Promise.resolve(42))).toBe(42);
    const error = new Error("operation");
    await expect(context.measure("execute", () => Promise.reject(error))).rejects.toBe(error);
    expect(context.diagnostics()).toEqual({ recorded: 0, dropped: 0, errors: 2 });
  });
  it("bounds attempts, expires and disposes without timers or retained observations", () => {
    let now = 0;
    const spans: StackLatencySpan[] = [];
    const make = () => createStackLatencyContext({ traceId, clock: "sessiond", operation: "session-open", sink: { record: span => { spans.push(span); } }, now: () => now });
    const context = make();
    for (let i = 0; i < 514; i++) context.start("execute")();
    expect(spans).toHaveLength(512);
    expect(context.diagnostics()).toEqual({ recorded: 512, dropped: 2, errors: 0 });
    const expired = make();
    const finish = expired.start("execute");
    now = 300_001;
    finish(); finish();
    expect(expired.diagnostics()).toEqual({ recorded: 0, dropped: 1, errors: 0 });
    const disposed = make();
    const pending = disposed.start("execute");
    disposed.dispose(); pending(); disposed.start("execute")();
    expect(disposed.diagnostics()).toEqual({ recorded: 0, dropped: 2, errors: 0 });
  });
});
