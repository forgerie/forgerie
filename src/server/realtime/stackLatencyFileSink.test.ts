import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stackLatencySpanSchema, type StackLatencySpan } from "../../shared/stackLatency.js";
import { stackLatencyFileSinkFromEnvironment } from "./stackLatencyFileSink.js";

const span: StackLatencySpan = { version: 1, traceId: "d".repeat(32), spanId: "1", parentSpanId: "0", clock: "sessiond", operation: "session-open",
  phase: "execute", startMs: 1, durationMs: 2, outcome: "ok" };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("opt-in daemon span file", () => {
  it("is absent unless a temporary profile names an absolute file", () => {
    expect(stackLatencyFileSinkFromEnvironment({})).toBeUndefined();
    expect(stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: "" })).toBeUndefined();
    expect(() => stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: "relative.jsonl" })).toThrow("absolute");
  });
  it("appends owner-only validated span lines off the request path and bounds pending lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-span-file-"));
    directories.push(directory);
    const path = join(directory, "spans.jsonl");
    const sink = stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: path }, { maxPending: 3 });
    if (sink === undefined) throw new Error("expected sink");
    for (let index = 0; index < 5; index++) sink.record({ ...span, spanId: String(index + 1) });
    // Recording never waits for the file system.
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await sink.close();
    const lines = (await readFile(path, "utf8")).trim().split("\n").map(line => stackLatencySpanSchema.parse(JSON.parse(line)));
    expect(lines.map(line => line.spanId)).toEqual(["1", "2", "3"]);
    expect(sink.diagnostics()).toEqual({ written: 3, dropped: 2, errors: 0 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    sink.record(span);
    expect(sink.diagnostics().dropped).toBe(3);
  });
  it("never writes through a symlink and caps the file in bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-span-file-"));
    directories.push(directory);
    const target = join(directory, "target");
    await writeFile(target, "unchanged");
    const link = join(directory, "spans.jsonl");
    await symlink(target, link);
    const linked = stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: link });
    if (linked === undefined) throw new Error("expected sink");
    linked.record(span);
    await linked.close();
    expect(linked.diagnostics()).toEqual({ written: 0, dropped: 0, errors: 1 });
    expect(await readFile(target, "utf8")).toBe("unchanged");
    const line = Buffer.byteLength(`${JSON.stringify(span)}\n`);
    const capped = stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: join(directory, "capped.jsonl") }, { maxBytes: line * 2 });
    if (capped === undefined) throw new Error("expected sink");
    for (let index = 0; index < 4; index++) capped.record(span);
    await capped.close();
    expect(capped.diagnostics()).toEqual({ written: 2, dropped: 2, errors: 0 });
    expect((await stat(join(directory, "capped.jsonl"))).size).toBe(line * 2);
  });
  it("counts write failures without throwing into the product path", async () => {
    const sink = stackLatencyFileSinkFromEnvironment({ PI_WEB_STACK_LATENCY_FILE: "/proc/forgerie-missing/spans.jsonl" });
    if (sink === undefined) throw new Error("expected sink");
    sink.record(span);
    await sink.close();
    expect(sink.diagnostics()).toEqual({ written: 0, dropped: 0, errors: 1 });
  });
});
