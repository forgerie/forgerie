import Fastify from "fastify";
import { expect, it } from "vitest";
import { registerDurableTaskRoutes } from "./durableTaskRoutes.js";

it("serves ready and unsupported tasks and maps invalid, missing, and failed reads", async () => {
  const app = Fastify();
  const calls: unknown[] = [];
  registerDurableTaskRoutes(app, { durableTasks(ref) {
    calls.push(ref);
    if (ref.id === "missing") return Promise.reject(new Error("Session not found"));
    if (ref.id === "failed") return Promise.reject(new Error("private inspection details"));
    return Promise.resolve(ref.id === "legacy" ? { kind: "unsupported" } : { kind: "ready", parentConversationId: 1, backgroundAgents: 0, agents: [], tasks: [] });
  } }, "/api");
  try {
    const get = (id: string, query = "?cwd=/tmp") => app.inject({ method: "GET", url: `/api/sessions/${id}/tasks${query}` });
    expect((await get("native")).json()).toEqual({ kind: "ready", parentConversationId: 1, backgroundAgents: 0, agents: [], tasks: [] });
    expect((await get("legacy")).json()).toEqual({ kind: "unsupported" });
    for (const query of ["", "?cwd=", "?cwd=/tmp&cwd=/other", "?cwd=/tmp&input=private", "?cwd=relative", "?cwd=/%00"]) expect((await get("native", query)).statusCode).toBe(400);
    expect((await get("missing")).statusCode).toBe(404);
    const failed = await get("failed");
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: "Could not read tasks" });
    expect(calls).toEqual(["native", "legacy", "missing", "failed"].map(id => ({ id, cwd: "/tmp" })));
  } finally { await app.close(); }
});
