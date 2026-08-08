import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ManagedProcessKillResult,
  ManagedProcessOutputResult,
  ManagedProcessesSnapshot,
  ManagedProcessWriteResult,
} from "../../shared/apiTypes.js";
import { registerProcessRoutes, type ProcessRouteService } from "./processRoutes.js";
import type { SessionRouteRef } from "./sessionService.js";

let app: FastifyInstance;
let service: RecordingProcessService;

beforeEach(() => {
  app = Fastify({ logger: false });
  service = new RecordingProcessService();
  registerProcessRoutes(app, service);
});

afterEach(async () => {
  await app.close();
});

describe("process routes", () => {
  it("returns the selected session snapshot with normalized cwd context", async () => {
    const cwd = resolve("/repo");
    const response = await app.inject({
      method: "GET",
      url: `/sessions/session-1/processes?cwd=${encodeURIComponent(cwd)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(service.snapshot);
    expect(service.calls).toEqual([{ action: "list", ref: { id: "session-1", cwd } }]);
  });

  it("bounds output queries at the HTTP contract", async () => {
    const valid = await app.inject({
      method: "GET",
      url: `/sessions/session-1/processes/process-1/output?cwd=${encodeURIComponent("/repo")}&tailLines=200`,
    });
    const invalid = await app.inject({
      method: "GET",
      url: `/sessions/session-1/processes/process-1/output?cwd=${encodeURIComponent("/repo")}&tailLines=201`,
    });

    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual(service.outputResult);
    expect(service.calls[0]).toEqual({ action: "output", ref: { id: "session-1", cwd: resolve("/repo") }, processId: "process-1", tailLines: 200 });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "tailLines must be an integer from 1 to 200" });
  });

  it("routes stop and stdin-write controls", async () => {
    const killed = await app.inject({
      method: "POST",
      url: "/sessions/session-1/processes/process-1/kill",
      payload: { cwd: "/repo" },
    });
    const written = await app.inject({
      method: "POST",
      url: "/sessions/session-1/processes/process-1/write",
      payload: { cwd: "/repo", input: "continue\n", end: true },
    });

    expect(killed.statusCode).toBe(200);
    expect(killed.json()).toEqual(service.killResult);
    expect(written.statusCode).toBe(200);
    expect(written.json()).toEqual({ ok: true });
    expect(service.calls).toContainEqual({ action: "kill", ref: { id: "session-1", cwd: resolve("/repo") }, processId: "process-1" });
    expect(service.calls).toContainEqual({ action: "write", ref: { id: "session-1", cwd: resolve("/repo") }, processId: "process-1", input: "continue\n", end: true });
  });

  it("allows EOF-only writes and rejects empty no-op writes", async () => {
    const eof = await app.inject({
      method: "POST",
      url: "/sessions/session-1/processes/process-1/write",
      payload: { cwd: "/repo", end: true },
    });
    const empty = await app.inject({
      method: "POST",
      url: "/sessions/session-1/processes/process-1/write",
      payload: { cwd: "/repo", input: "" },
    });

    expect(eof.statusCode).toBe(200);
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: "input or end=true is required" });
  });

  it("requires cwd and a bounded process id", async () => {
    const missingCwd = await app.inject({ method: "GET", url: "/sessions/session-1/processes" });
    const longId = await app.inject({
      method: "POST",
      url: `/sessions/session-1/processes/${"x".repeat(65)}/kill`,
      payload: { cwd: "/repo" },
    });

    expect(missingCwd.statusCode).toBe(400);
    expect(missingCwd.json()).toEqual({ error: "cwd query parameter is required" });
    expect(longId.statusCode).toBe(400);
    expect(longId.json()).toEqual({ error: "processId is too long" });
  });

  it("keeps internal service failures as server errors", async () => {
    service.error = new Error("process bridge failed");

    const response = await app.inject({
      method: "POST",
      url: "/sessions/session-1/processes/process-1/kill",
      payload: { cwd: "/repo" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "process bridge failed" });
  });

  it("maps missing sessions to not found", async () => {
    service.error = new Error("Session not found");

    const response = await app.inject({
      method: "GET",
      url: `/sessions/missing/processes?cwd=${encodeURIComponent("/repo")}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

class RecordingProcessService implements ProcessRouteService {
  readonly calls: Record<string, unknown>[] = [];
  snapshot: ManagedProcessesSnapshot = { available: true, writeSupported: true, processes: [] };
  outputResult: ManagedProcessOutputResult = { ok: true, lines: [{ type: "stdout", text: "ready" }] };
  killResult: ManagedProcessKillResult = { ok: false, reason: "not_found" };
  writeResult: ManagedProcessWriteResult = { ok: true };
  error: Error | undefined;

  processes(ref: SessionRouteRef): Promise<ManagedProcessesSnapshot> {
    if (this.error !== undefined) return Promise.reject(this.error);
    this.calls.push({ action: "list", ref });
    return Promise.resolve(this.snapshot);
  }

  processOutput(ref: SessionRouteRef, processId: string, tailLines?: number): Promise<ManagedProcessOutputResult> {
    if (this.error !== undefined) return Promise.reject(this.error);
    this.calls.push({ action: "output", ref, processId, tailLines });
    return Promise.resolve(this.outputResult);
  }

  killProcess(ref: SessionRouteRef, processId: string): Promise<ManagedProcessKillResult> {
    if (this.error !== undefined) return Promise.reject(this.error);
    this.calls.push({ action: "kill", ref, processId });
    return Promise.resolve(this.killResult);
  }

  writeProcess(ref: SessionRouteRef, processId: string, input: string, end?: boolean): Promise<ManagedProcessWriteResult> {
    if (this.error !== undefined) return Promise.reject(this.error);
    this.calls.push({ action: "write", ref, processId, input, end });
    return Promise.resolve(this.writeResult);
  }
}
