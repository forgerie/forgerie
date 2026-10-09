import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { WorktreeCleanupReport, WorktreeCleanupState } from "../../shared/worktreeCleanup.js";
import { registerWorktreeCleanupRoutes } from "./worktreeCleanupRoutes.js";

const report: WorktreeCleanupReport = {
  startedAt: "2026-10-09T00:00:00.000Z", finishedAt: "2026-10-09T00:00:01.000Z",
  kept: [{ id: "w1", repo: "/repo", path: "/repo/.worktrees/w1", branch: "w1", reason: "dirty" }], removed: [],
};
function setup(error?: string) {
  const app = Fastify();
  let calls = 0;
  let state: WorktreeCleanupState = { phase: "never-run" };
  // The route boundary consumes a configurable job contract; real Git cleanup is tested in worktreeCleanupJob.test.ts.
  registerWorktreeCleanupRoutes(app, {
    snapshot: () => state,
    run: () => {
      calls++;
      if (error !== undefined) { state = { phase: "failed", error }; return Promise.reject(new Error(error)); }
      state = { phase: "done", report };
      return Promise.resolve(report);
    },
  }, "/api");
  app.get("/api/sessions/worktrees/:id", () => ({ wrongRoute: true }));
  return { app, calls: () => calls };
}

describe("worktree cleanup API", () => {
  it("reads without side effects and returns the exact report from an explicit run", async () => {
    const f = setup();
    expect((await f.app.inject("/api/sessions/worktrees/cleanup")).json()).toEqual({ phase: "never-run" });
    expect(f.calls()).toBe(0);
    const run = await f.app.inject({ method: "POST", url: "/api/sessions/worktrees/cleanup", payload: {} });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toEqual(report);
    expect((await f.app.inject("/api/sessions/worktrees/cleanup")).json()).toEqual({ phase: "done", report });
    await f.app.close();
  });

  it("rejects force and other extra input, but accepts an absent body", async () => {
    const f = setup();
    expect((await f.app.inject({ method: "POST", url: "/api/sessions/worktrees/cleanup", payload: { force: true } })).statusCode).toBe(400);
    expect(f.calls()).toBe(0);
    expect((await f.app.inject({ method: "POST", url: "/api/sessions/worktrees/cleanup" })).statusCode).toBe(200);
    expect(f.calls()).toBe(1);
    await f.app.close();
  });

  it("reports a failed run without returning a successful report", async () => {
    const f = setup("ownership inventory unavailable");
    const result = await f.app.inject({ method: "POST", url: "/api/sessions/worktrees/cleanup", payload: {} });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({ error: "ownership inventory unavailable" });
    expect((await f.app.inject("/api/sessions/worktrees/cleanup")).json()).toEqual({ phase: "failed", error: "ownership inventory unavailable" });
    await f.app.close();
  });
});
