import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedProcessInfo, SessionUiEvent } from "../../shared/apiTypes.js";
import { createProcessBridgeSlot } from "./processBridge.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("process bridge snapshots", () => {
  it("distinguishes an unavailable extension from an empty process list", () => {
    const events = createEventBus();
    const slot = createProcessBridgeSlot();

    expect(slot.snapshot()).toEqual({ available: false, writeSupported: false, processes: [] });

    registerManagerProtocol(events, { processes: [] });
    slot.attach(events);
    expect(slot.snapshot()).toEqual({ available: true, writeSupported: false, processes: [] });
  });

  it("projects browser-safe process state without daemon log paths", () => {
    const events = createEventBus();
    registerManagerProtocol(events, {
      processes: [processInfo({
        id: "process-1",
        status: "terminating",
        signal: { name: "SIGTERM", number: 15, description: "Terminated" },
      })],
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.snapshot()).toEqual({
      available: true,
      writeSupported: false,
      processes: [{
        id: "process-1",
        name: "dev-server",
        pid: 123,
        command: "node server.js",
        cwd: "/repo",
        startTime: 1000,
        endTime: null,
        status: "terminating",
        exitCode: null,
        success: null,
        endReason: null,
        signal: { name: "SIGTERM", number: 15, description: "Terminated" },
        errorMessage: null,
      }],
    });
  });

  it("treats a malformed list response as unavailable", () => {
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [{ id: 123 }] });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.snapshot()).toEqual({ available: false, writeSupported: false, processes: [] });
  });
});

describe("process bridge requests", () => {
  it("probes and caches patched stdin-write support", () => {
    const events = createEventBus();
    const writes: { id: string; input: string; end: boolean | undefined }[] = [];
    registerManagerProtocol(events, {
      processes: [],
      write(payload) {
        writes.push({
          id: stringField(payload, "id") ?? "",
          input: stringField(payload, "input") ?? "",
          end: booleanField(payload, "end"),
        });
        reply(payload, { ok: false, reason: "not_found" });
      },
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.snapshot().writeSupported).toBe(true);
    expect(slot.snapshot().writeSupported).toBe(true);
    expect(writes).toEqual([{ id: "__forgerie_capability_probe__", input: "", end: true }]);
  });

  it("writes input or EOF and preserves manager error reasons", () => {
    const events = createEventBus();
    registerManagerProtocol(events, {
      processes: [],
      write(payload) {
        const id = stringField(payload, "id");
        if (id === "exited") reply(payload, { ok: false, reason: "process_exited" });
        else if (id === "closed") reply(payload, { ok: false, reason: "stdin_closed" });
        else if (id === "broken") reply(payload, { ok: false, reason: "write_error" });
        else if (id === "__forgerie_capability_probe__") reply(payload, { ok: false, reason: "not_found" });
        else reply(payload, { ok: true });
      },
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.write("running", "continue\n")).toEqual({ ok: true });
    expect(slot.write("running", "", { end: true })).toEqual({ ok: true });
    expect(slot.write("exited", "late")).toEqual({ ok: false, reason: "process_exited" });
    expect(slot.write("closed", "late")).toEqual({ ok: false, reason: "stdin_closed" });
    expect(slot.write("broken", "data")).toEqual({ ok: false, reason: "write_error" });
  });

  it("reports stdin writes as unsupported when the unpatched extension does not reply", () => {
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [] });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.write("process-1", "input")).toEqual({ ok: false, reason: "unsupported" });
  });

  it("bounds output requests and validates the response", () => {
    const events = createEventBus();
    const tails: number[] = [];
    registerManagerProtocol(events, {
      processes: [],
      output(payload) {
        tails.push(numberField(payload, "tailLines") ?? -1);
        reply(payload, [{ type: "stdout", text: "ready" }]);
      },
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.output("process-1")).toEqual({ ok: true, lines: [{ type: "stdout", text: "ready" }] });
    expect(slot.output("process-1", 500).ok).toBe(true);
    expect(slot.output("process-1", 0).ok).toBe(true);
    expect(tails).toEqual([50, 200, 1]);
  });

  it("distinguishes missing and malformed output", () => {
    const events = createEventBus();
    let response: unknown = null;
    registerManagerProtocol(events, {
      processes: [],
      output(payload) {
        reply(payload, response);
      },
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    expect(slot.output("missing")).toEqual({ ok: false, reason: "not_found" });
    response = [{ type: "other", text: "invalid" }];
    expect(slot.output("malformed")).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("returns kill replies and times out when the manager does not reply", async () => {
    vi.useFakeTimers();
    const events = createEventBus();
    let replyToKills = true;
    registerManagerProtocol(events, {
      processes: [],
      kill(payload) {
        if (!replyToKills) return;
        setTimeout(() => {
          reply(payload, { ok: true, info: processInfo({ id: stringField(payload, "id") ?? "" }) });
        }, 10);
      },
    });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    const successPromise = slot.kill("process-1", { signal: "SIGKILL", timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await successPromise).toMatchObject({ ok: true, process: { id: "process-1" } });

    replyToKills = false;
    const timeoutPromise = slot.kill("process-2", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(await timeoutPromise).toEqual({ ok: false, reason: "timeout" });
  });

  it("settles an in-flight kill when the bridge is disposed", async () => {
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [], kill(payload) { void payload; } });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    const pending = slot.kill("process-1");
    slot.dispose();

    await expect(pending).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("bounds concurrent unanswered kill requests", async () => {
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [], kill(payload) { void payload; } });
    const slot = createProcessBridgeSlot();
    slot.attach(events);

    const pending = Array.from({ length: 10 }, (_, index) => slot.kill(`process-${String(index)}`));
    await expect(slot.kill("process-overflow")).resolves.toEqual({ ok: false, reason: "error" });
    slot.dispose();
    await expect(Promise.all(pending)).resolves.toEqual(Array.from({ length: 10 }, () => ({ ok: false, reason: "unavailable" })));
  });
});

describe("process bridge events", () => {
  it("publishes authoritative snapshots and retains the publisher across reload attachment", () => {
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [processInfo()] });
    const slot = createProcessBridgeSlot();
    const published: SessionUiEvent[] = [];
    slot.setPublisher((event) => { published.push(event); });
    slot.attach(events);
    published.length = 0;

    events.emit("processes:changed", { reason: "started" });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: "processes.update", snapshot: { available: true, processes: [{ id: "process-1" }] } });

    slot.attach(events);
    published.length = 0;
    events.emit("processes:changed", { reason: "cleared" });
    expect(published).toHaveLength(1);
  });

  it("throttles chatty output and bounds memory before publication", async () => {
    vi.useFakeTimers();
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [] });
    const slot = createProcessBridgeSlot();
    const published: SessionUiEvent[] = [];
    slot.setPublisher((event) => { published.push(event); });
    slot.attach(events);
    published.length = 0;

    for (let index = 0; index < 250; index += 1) {
      events.emit("processes:output_changed", {
        id: "process-1",
        appendedText: [{ type: "stdout", text: `${String(index)}:${"x".repeat(200)}\n` }],
      });
    }
    expect(published).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    const outputEvent = published.find((event) => event.type === "processes.output");
    if (outputEvent?.type !== "processes.output") throw new Error("Expected processes.output event");
    expect(outputEvent.lines.length).toBeLessThanOrEqual(200);
    expect(outputEvent.lines.reduce((bytes, line) => bytes + Buffer.byteLength(line.text, "utf8"), 0)).toBeLessThanOrEqual(32 * 1024);
    expect(outputEvent.droppedLines).toBeGreaterThan(0);
  });

  it("publishes dropped-line-only updates and sums upstream dropped counts", async () => {
    vi.useFakeTimers();
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [] });
    const slot = createProcessBridgeSlot();
    const published: SessionUiEvent[] = [];
    slot.setPublisher((event) => { published.push(event); });
    slot.attach(events);
    published.length = 0;

    events.emit("processes:output_changed", { id: "process-1", droppedLines: 2 });
    events.emit("processes:output_changed", { id: "process-1", droppedLines: 3 });
    await vi.advanceTimersByTimeAsync(250);

    expect(published).toContainEqual({ type: "processes.output", id: "process-1", lines: [], droppedLines: 5 });
  });

  it("ignores malformed broadcasts and removes listeners and timers on dispose", async () => {
    vi.useFakeTimers();
    const events = createEventBus();
    registerManagerProtocol(events, { processes: [] });
    const slot = createProcessBridgeSlot();
    const published: SessionUiEvent[] = [];
    slot.setPublisher((event) => { published.push(event); });
    slot.attach(events);
    published.length = 0;

    events.emit("processes:changed", { reason: 123 });
    events.emit("processes:output_changed", { id: "process-1", appendedText: "invalid" });
    events.emit("processes:output_changed", { id: "process-1", appendedText: [{ type: "stdout", text: "queued" }] });
    slot.dispose();
    await vi.advanceTimersByTimeAsync(500);
    events.emit("processes:changed", { reason: "ended" });

    expect(published).toEqual([]);
  });
});

interface ManagerProtocolOptions {
  processes: unknown[];
  output?: (payload: unknown) => void;
  kill?: (payload: unknown) => void;
  write?: (payload: unknown) => void;
}

function registerManagerProtocol(events: EventBus, options: ManagerProtocolOptions): void {
  events.on("processes:request:config", (payload) => { reply(payload, { output: {} }); });
  events.on("processes:request:list", (payload) => { reply(payload, options.processes); });
  if (options.output !== undefined) events.on("processes:request:combined_output", options.output);
  if (options.kill !== undefined) events.on("processes:command:kill", options.kill);
  if (options.write !== undefined) events.on("processes:command:write", options.write);
}

function processInfo(overrides: Partial<ManagedProcessInfo> = {}): Record<string, unknown> {
  return {
    id: "process-1",
    name: "dev-server",
    pid: 123,
    command: "node server.js",
    cwd: "/repo",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

function reply(payload: unknown, value: unknown): void {
  const callback = property(payload, "reply");
  if (typeof callback === "function") Reflect.apply(callback, undefined, [value]);
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = property(value, key);
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const field = property(value, key);
  return typeof field === "number" ? field : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const field = property(value, key);
  return typeof field === "boolean" ? field : undefined;
}
