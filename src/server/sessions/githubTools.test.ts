import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Check } from "typebox/value";
import { GitHubAgent } from "../github/githubAgent.js";
import { FakeGitHub, json } from "../github/fakeGitHub.testSupport.js";
import { IssueProposals } from "./issueProposals.js";
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
    const watch = tools[3];
    if (watch === undefined) throw new Error("Watch tool missing");
    expect(watch.exposure).toBe(MODEL_ONLY_EXPOSURE);
    await watch.execute("t3", { action: "start", number: 9 }, undefined, undefined, ctxFor("session-7"));
    expect(calls).toEqual([["/workspace", "session-7", "start", 9]]);
  });
  it("adds github_read and github_write to every hosted session, delegated or not, only when GitHub is wired", () => {
    const github: GitHubToolDeps = { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) };
    const names = (delegation: boolean) => createPiWebCustomToolDefinitions("/workspace", delegation, undefined, undefined, undefined, github).map((tool) => tool.name);
    expect(names(true)).toEqual(["edit", "github_read", "github_write", "propose_issue"]);
    expect(names(false)).toEqual(["edit", "github_read", "github_write", "propose_issue"]);
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

// The app boundary is scripted; proposal persistence and tool errors use the production paths.
describe("propose_issue", () => {
  it("is model-only, returns the proposal id, and targets an owned worktree", async () => {
    const calls: unknown[] = [];
    const tools = createGitHubToolDefinitions("/repo-a", { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }),
      target: (ref, id) => { calls.push([ref, id]); return id === "owned" ? Promise.resolve("/repo-b") : Promise.reject(new Error("Unknown worktree")); },
      propose: (ref, cwd, input) => { calls.push([ref, cwd, input]); return Promise.resolve({ proposalId: "p1", repo: "o/r", title: input.title, body: input.body, labels: input.labels ?? [] }); },
    });
    const propose = tools[2];
    expect(propose.name).toBe("propose_issue");
    expect(propose.exposure).toBe(MODEL_ONLY_EXPOSURE);
    const result = await propose.execute("t1", { title: "Fix", body: "Details", worktreeId: "owned" }, undefined, undefined, ctxFor("s1"));
    expect(result.details).toEqual({ proposalId: "p1" });
    expect(result.content[0]).toHaveProperty("text", expect.stringContaining("The user decides"));
    expect(calls).toEqual([[{ id: "s1", cwd: "/repo-a" }, "owned"], [{ id: "s1", cwd: "/repo-a" }, "/repo-b", { title: "Fix", body: "Details" }]]);
    await expect(propose.execute("t2", { title: "Fix", body: "", worktreeId: "foreign" }, undefined, undefined, ctxFor("s1"))).rejects.toThrow("Unknown worktree");
  });
  it("does not offer create_issue in github_write", () => {
    const tools = createGitHubToolDefinitions("/repo", { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) });
    expect(Check(tools[1].parameters, { action: "create_issue", title: "Fix" })).toBe(false);
    expect(JSON.stringify(tools[1].parameters)).not.toContain("create_issue");
  });
  it("reports unknown labels and a missing GitHub repo as tool errors without recording proposals", async () => {
    const github = new FakeGitHub();
    github.always("GET https://api.github.com/repos/o/r", json({ default_branch: "main" }));
    github.always("GET https://api.github.com/repos/o/r/labels", json([{ name: "bug", description: null }]));
    github.always("GET https://api.github.com/repos/o/missing", json({ message: "Not Found" }, { status: 404 }));
    const agent = new GitHubAgent({ fetch: github.fetch, app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken() { /* Test tokens do not expire. */ }, status: () => ({ state: "not-configured" }) },
      trust: { judge: () => Promise.resolve(() => true) }, resolveRepo: (cwd) => Promise.resolve({ slug: cwd === "/missing" ? "o/missing" : "o/r", everyone: true }) });
    let recorded = 0;
    const proposals = new IssueProposals({ prepare: (cwd, input) => agent.prepareIssue(cwd, input), create: (repo, id, input) => agent.createIssue(repo, id, input) });
    const tools = (cwd: string) => createGitHubToolDefinitions(cwd, { read: (cwd, input) => agent.read(cwd, input), write: (cwd, id, input) => agent.write(cwd, id, input),
      propose: (ref, target, input) => proposals.propose({ id: ref.id, branch: () => [], append: () => { recorded++; return Promise.resolve(); } }, target, input) });
    await expect(tools("/repo")[2].execute("labels", { title: "Fix", body: "", labels: ["unknown"] }, undefined, undefined, ctxFor("s1"))).rejects.toThrow("These labels do not exist");
    await expect(tools("/missing")[2].execute("repo", { title: "Fix", body: "" }, undefined, undefined, ctxFor("s1"))).rejects.toThrow("HTTP 404");
    expect(recorded).toBe(0);
    expect(github.requests.every((request) => request.method === "GET")).toBe(true);
  });
  it("reports a non-GitHub origin as a tool error", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-propose-non-github-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      execFileSync("git", ["-C", root, "remote", "add", "origin", "https://example.com/owner/repo.git"]);
      const agent = new GitHubAgent({ fetch: () => Promise.reject(new Error("Network must not be reached")), app: { tokenFor: () => Promise.reject(new Error("App must not be reached")), dropToken() { /* No tokens are minted. */ }, status: () => ({ state: "not-configured" }) }, trust: { judge: () => Promise.resolve(() => true) } });
      const proposals = new IssueProposals({ prepare: (cwd, input) => agent.prepareIssue(cwd, input), create: (repo, id, input) => agent.createIssue(repo, id, input) });
      const tools = createGitHubToolDefinitions(root, { read: (cwd, input) => agent.read(cwd, input), write: (cwd, id, input) => agent.write(cwd, id, input),
        propose: (ref, target, input) => proposals.propose({ id: ref.id, branch: () => [], append: () => Promise.reject(new Error("Must not record")) }, target, input) });
      await expect(tools[2].execute("repo", { title: "Fix", body: "" }, undefined, undefined, ctxFor("s1"))).rejects.toThrow("has no GitHub repo");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
