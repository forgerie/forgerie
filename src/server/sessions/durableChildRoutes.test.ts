import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerDurableChildRoutes, type DurableChildRouteService } from "./durableChildRoutes.js";

function setup() {
  const calls: unknown[][] = [];
  const service: DurableChildRouteService = {
    durableChildren: (ref) => { calls.push(["list", ref]); return Promise.resolve([{ name: "ui" }]); },
    durableChildMessages: (ref, id) => { calls.push(["messages", ref, id]); return Promise.resolve({ messages: [], busy: false }); },
    messageDurableChild: (ref, id, text) => { calls.push(["message", ref, id, text]); return Promise.resolve(); },
    stopDurableChild: (ref, id) => { calls.push(["stop", ref, id]); return Promise.resolve(); },
    landDurableChildWorktree: (ref, id) => { calls.push(["land", ref, id]); return Promise.resolve({ kind: "landed", sha: "abc", cleanup: { kind: "done" } }); },
    previewDurableChildWorktreeDiscard: (ref, id) => { calls.push(["preview", ref, id]); return Promise.resolve({ confirmationToken: "current" }); },
    discardDurableChildWorktree: (ref, id, token) => { calls.push(["discard", ref, id, token]); return Promise.resolve({ kind: "stale-preview" }); },
    answerDurableChildQuestion: (ref, questionId, answer) => {
      calls.push(["answer", ref, questionId, answer]);
      return questionId === "closed" ? Promise.reject(new Error("Question closed is not open")) : Promise.resolve();
    },
  };
  const app = Fastify();
  registerDurableChildRoutes(app, service);
  return { app, calls };
}

describe("durable child routes", () => {
  it("passes each request to the service with the session ref", async () => {
    const { app, calls } = setup();
    expect((await app.inject({ method: "GET", url: "/sessions/s1/children?cwd=/tmp" })).json()).toEqual([{ name: "ui" }]);
    expect((await app.inject({ method: "GET", url: "/sessions/s1/children/7/messages?cwd=/tmp" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/sessions/s1/children/7/message", payload: { cwd: "/tmp", text: "go" } })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "POST", url: "/sessions/s1/children/7/stop", payload: { cwd: "/tmp" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/sessions/s1/children/questions/answer", payload: { cwd: "/tmp", questionId: "q:1", answer: "Teal" } })).statusCode).toBe(200);
    expect(calls).toEqual([
      ["list", { id: "s1", cwd: "/tmp" }],
      ["messages", { id: "s1", cwd: "/tmp" }, 7],
      ["message", { id: "s1", cwd: "/tmp" }, 7, "go"],
      ["stop", { id: "s1", cwd: "/tmp" }, 7],
      ["answer", { id: "s1", cwd: "/tmp" }, "q:1", "Teal"],
    ]);
  });

  it("passes child worktree actions and confirmation tokens without treating a domain outcome as success", async () => {
    const { app, calls } = setup();
    const base = "/sessions/s1/children/7/worktree";
    expect((await app.inject({ method: "POST", url: `${base}/land`, payload: { cwd: "/tmp" } })).json()).toMatchObject({ kind: "landed" });
    expect((await app.inject({ method: "POST", url: `${base}/discard-preview`, payload: { cwd: "/tmp" } })).json()).toEqual({ confirmationToken: "current" });
    expect((await app.inject({ method: "POST", url: `${base}/discard`, payload: { cwd: "/tmp", confirmationToken: "old" } })).json()).toEqual({ kind: "stale-preview" });
    expect(calls).toEqual([["land", { id: "s1", cwd: "/tmp" }, 7], ["preview", { id: "s1", cwd: "/tmp" }, 7], ["discard", { id: "s1", cwd: "/tmp" }, 7, "old"]]);
    expect((await app.inject({ method: "POST", url: `${base}/discard`, payload: { cwd: "/tmp" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${base}/discard`, payload: { cwd: "/tmp", confirmationToken: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${base}/land`, payload: { cwd: "/tmp", unexpected: true } })).statusCode).toBe(400);
    expect(calls).toHaveLength(3);
  });

  it("rejects bad input and maps a closed question to 409", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/sessions/s1/children" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/sessions/s1/children/abc/messages?cwd=/tmp" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/sessions/s1/children/7/message", payload: { cwd: "/tmp", text: " " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/sessions/s1/children/questions/answer", payload: { cwd: "/tmp", questionId: "closed", answer: "x" } })).statusCode).toBe(409);
  });
});
