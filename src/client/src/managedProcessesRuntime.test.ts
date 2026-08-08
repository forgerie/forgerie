/* eslint-disable @typescript-eslint/unbound-method -- API methods are Vitest function mocks in this file. */
import { describe, expect, it, vi } from "vitest";
import { createManagedProcessesRuntime, type ManagedProcessesApi } from "./managedProcessesRuntime";

function api(): ManagedProcessesApi {
  return {
    processes: vi.fn(() => Promise.resolve({ available: true, writeSupported: true, processes: [] })),
    processOutput: vi.fn(() => Promise.resolve({ ok: true as const, lines: [] })),
    killProcess: vi.fn(() => Promise.resolve({ ok: false as const, reason: "not_found" as const })),
    writeProcess: vi.fn(() => Promise.resolve({ ok: true as const })),
  };
}

describe("managed processes runtime", () => {
  it("binds every request to the selected machine and session", async () => {
    const client = api();
    const target = { machineId: "remote", id: "session-1", cwd: "/repo" };
    const runtime = createManagedProcessesRuntime(target, client, () => vi.fn());

    await runtime.snapshot();
    await runtime.output("process-1", 50);
    await runtime.kill("process-1");
    await runtime.write("process-1", "input\n");

    const processes = vi.mocked(client.processes);
    const output = vi.mocked(client.processOutput);
    const kill = vi.mocked(client.killProcess);
    const write = vi.mocked(client.writeProcess);
    expect(processes).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "remote");
    expect(output).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "process-1", 50, "remote");
    expect(kill).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "process-1", "remote");
    expect(write).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "process-1", "input\n", "remote");
  });

  it("returns unavailable results without making requests when no session is selected", async () => {
    const client = api();
    const runtime = createManagedProcessesRuntime(undefined, client, () => vi.fn());

    await expect(runtime.snapshot()).resolves.toEqual({ available: false, writeSupported: false, processes: [] });
    await expect(runtime.output("process-1")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(runtime.kill("process-1")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(runtime.write("process-1", "input")).resolves.toEqual({ ok: false, reason: "unavailable" });
    const processes = vi.mocked(client.processes);
    expect(processes).not.toHaveBeenCalled();
  });

  it("delegates subscriptions", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const runtime = createManagedProcessesRuntime(undefined, api(), subscribe);
    const listener = vi.fn();

    expect(runtime.subscribe(listener)).toBe(unsubscribe);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });
});
