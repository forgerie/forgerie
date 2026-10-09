import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";
import { createGitHubToolDefinitions, type GitHubToolDeps } from "./githubTools.js";
import { createPiWebCustomToolDefinitions } from "./piSessionService.js";

function ctxFor(sessionId: string): ExtensionToolContext {
  const sessionManager = { getSessionId: () => sessionId, getSessionFile: () => undefined };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub with the minimal surface the tool uses.
  return { sessionManager } as unknown as ExtensionToolContext;
}

describe("GitHub tools", () => {
  it("exposes opt-in watch control only when wired and scopes it to the current session", async () => {
    const calls: unknown[] = [];
    const tools = createGitHubToolDefinitions("/workspace", { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }),
      watch: (cwd, id, action, number) => { calls.push([cwd, id, action, number]); return Promise.resolve({ watch: { kind: "watching" } }); } });
    const watch = tools[2];
    if (watch === undefined) throw new Error("Watch tool missing");
    expect(watch.exposure).toBe(MODEL_ONLY_EXPOSURE);
    await watch.execute("t3", { action: "start", number: 9 }, undefined, undefined, ctxFor("session-7"));
    expect(calls).toEqual([["/workspace", "session-7", "start", 9]]);
  });
  it("adds github_read and github_write to every hosted session, delegated or not, only when GitHub is wired", () => {
    const github: GitHubToolDeps = { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) };
    const names = (delegation: boolean) => createPiWebCustomToolDefinitions("/workspace", delegation, undefined, undefined, undefined, undefined, github).map((tool) => tool.name);
    expect(names(true)).toEqual(["edit", "github_read", "github_write"]);
    expect(names(false)).toEqual(["edit", "github_read", "github_write"]);
    expect(createPiWebCustomToolDefinitions("/workspace", true).map((tool) => tool.name)).toEqual(["edit"]);
  });

  it("keeps writes out of scripts so each one shows in the transcript, and lets scripts read", () => {
    const [read, write] = createGitHubToolDefinitions("/workspace", { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) });
    expect(read).not.toHaveProperty("exposure");
    expect(write.exposure).toBe(MODEL_ONLY_EXPOSURE);
  });

  it("targets only a validated secondary checkout without changing the default repository", async () => {
    const calls: unknown[] = [];
    const [read, write] = createGitHubToolDefinitions("/repo-a", {
      target: (ref, id) => { calls.push(["resolve", ref, id]); return id === "owned-b" ? Promise.resolve("/repo-b/work") : Promise.reject(new Error("Not owned")); },
      read: (cwd, request) => { calls.push(["read", cwd, request]); return Promise.resolve("ok"); },
      write: (cwd, id, request) => { calls.push(["write", cwd, id, request]); return Promise.resolve({ text: "ok" }); },
    });
    await read.execute("read-b", { action: "prs", worktreeId: "owned-b" }, undefined, undefined, ctxFor("source"));
    await write.execute("write-b", { action: "comment", number: 7, body: "B only", worktreeId: "owned-b" }, undefined, undefined, ctxFor("source"));
    await read.execute("read-a", { action: "prs" }, undefined, undefined, ctxFor("source"));
    await expect(read.execute("refused", { action: "prs", worktreeId: "foreign" }, undefined, undefined, ctxFor("source"))).rejects.toThrow("Not owned");
    expect(calls).toContainEqual(["read", "/repo-b/work", { action: "prs" }]);
    expect(calls).toContainEqual(["write", "/repo-b/work", "source", { action: "comment", number: 7, body: "B only" }]);
    expect(calls).toContainEqual(["read", "/repo-a", { action: "prs" }]);
  });
  it("acts in the session's cwd and signs writes with the session id", async () => {
    const calls: unknown[] = [];
    const [read, write] = createGitHubToolDefinitions("/code/korri", {
      read: (cwd, request) => { calls.push(["read", cwd, request]); return Promise.resolve("#1 Issue"); },
      write: (cwd, sessionId, request) => { calls.push(["write", cwd, sessionId, request]); return Promise.resolve({ text: "Commented on #1.", url: "https://github.com/o/r/issues/1#c" }); },
    });
    const ctx = ctxFor("session-7");
    const readResult = await read.execute("t1", { action: "issues" }, undefined, undefined, ctx);
    const writeResult = await write.execute("t2", { action: "comment", number: 1, body: "Hi" }, undefined, undefined, ctx);
    expect(readResult.content).toEqual([{ type: "text", text: "#1 Issue" }]);
    expect(writeResult).toEqual({ content: [{ type: "text", text: "Commented on #1.\nhttps://github.com/o/r/issues/1#c" }], details: { action: "comment", url: "https://github.com/o/r/issues/1#c" } });
    expect(calls).toEqual([["read", "/code/korri", { action: "issues" }], ["write", "/code/korri", "session-7", { action: "comment", number: 1, body: "Hi" }]]);
  });
});
