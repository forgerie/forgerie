import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMachineRoutes, type MachineRouteService } from "./machineRoutes";

const machine = {
  id: "remote-1",
  name: "Remote",
  kind: "remote" as const,
  baseUrl: "https://remote.test",
  createdAt: "now",
  updatedAt: "now",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("machine routes", () => {
  it("maps list, create, lookup, health, and runtime results", async () => {
    const runtime = vi.fn<MachineRouteService["runtime"]>().mockResolvedValue({ machineId: machine.id, ok: true, checkedAt: "now" });
    const service = machineService({
      list: vi.fn().mockResolvedValue([machine]),
      add: vi.fn().mockResolvedValue(machine),
      get: vi.fn().mockResolvedValue(machine),
      health: vi.fn().mockResolvedValue({ machineId: machine.id, ok: true, checkedAt: "now", status: "online" }),
      runtime,
    });
    const app = Fastify();
    registerMachineRoutes(app, service);

    try {
      expect((await app.inject({ method: "GET", url: "/api/machines" })).json()).toEqual({ machines: [machine] });
      expect((await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.test" } })).json()).toEqual(machine);
      expect((await app.inject({ method: "GET", url: `/api/machines/${machine.id}` })).json()).toEqual(machine);
      expect((await app.inject({ method: "GET", url: `/api/machines/${machine.id}/health` })).json()).toMatchObject({ status: "online" });
      expect((await app.inject({ method: "GET", url: `/api/machines/${machine.id}/runtime?refresh=1` })).json()).toMatchObject({ ok: true });
      expect(runtime).toHaveBeenCalledWith(machine.id, true);
    } finally {
      await app.close();
    }
  });

  it("maps missing machines to 404 responses", async () => {
    const service = machineService({ get: vi.fn().mockResolvedValue(undefined), health: vi.fn().mockResolvedValue(undefined), runtime: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(false) });
    const app = Fastify();
    registerMachineRoutes(app, service);

    try {
      for (const request of [
        { method: "GET" as const, url: "/api/machines/missing" },
        { method: "GET" as const, url: "/api/machines/missing/health" },
        { method: "GET" as const, url: "/api/machines/missing/runtime" },
        { method: "PATCH" as const, url: "/api/machines/missing", payload: { name: "Missing" } },
        { method: "DELETE" as const, url: "/api/machines/missing" },
      ]) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: "Machine not found" });
      }
    } finally {
      await app.close();
    }
  });

  it("maps service validation failures and successful mutations", async () => {
    const service = machineService({
      add: vi.fn().mockRejectedValueOnce(new Error("invalid URL")),
      update: vi.fn().mockResolvedValueOnce(machine).mockRejectedValueOnce("invalid update"),
      remove: vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("local machine")),
    });
    const app = Fastify();
    registerMachineRoutes(app, service);

    try {
      const invalidCreate = await app.inject({ method: "POST", url: "/api/machines", payload: {} });
      expect(invalidCreate.statusCode).toBe(400);
      expect(invalidCreate.json()).toEqual({ error: "invalid URL" });

      expect((await app.inject({ method: "PATCH", url: `/api/machines/${machine.id}`, payload: { name: "Renamed" } })).json()).toEqual(machine);
      const invalidUpdate = await app.inject({ method: "PATCH", url: `/api/machines/${machine.id}`, payload: { name: "Bad" } });
      expect(invalidUpdate.statusCode).toBe(400);
      expect(invalidUpdate.json()).toEqual({ error: "invalid update" });

      expect((await app.inject({ method: "DELETE", url: `/api/machines/${machine.id}` })).json()).toEqual({ deleted: true });
      const invalidDelete = await app.inject({ method: "DELETE", url: "/api/machines/local" });
      expect(invalidDelete.statusCode).toBe(400);
      expect(invalidDelete.json()).toEqual({ error: "local machine" });
    } finally {
      await app.close();
    }
  });
});

function machineService(patch: Partial<MachineRouteService> = {}): MachineRouteService {
  return {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    get: vi.fn(),
    health: vi.fn(),
    runtime: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...patch,
  };
}
