import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { FakeGitHub, json } from "../github/fakeGitHub.testSupport.js";
import { GitHubAgent } from "../github/githubAgent.js";
import { ActionRunService } from "../github/actionRunService.js";
import { ActionRunStore } from "../github/actionRunStore.js";
import { PullRequestStore } from "../github/pullRequestStore.js";
import { createGitHubActionsToolDefinitions, createGitHubToolDefinitions } from "./githubTools.js";
import { createPiWebCustomToolDefinitions } from "./piSessionService.js";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Only session identity is read by these tool definitions.
const ctx = { sessionManager: { getSessionId: () => "s1" } } as unknown as ExtensionToolContext;
const base = "https://api.github.com/repos/owner/repo";

describe("github_actions tool", () => {
  it("dispatches with run details and links the receipt; a 204 links nothing and gives recovery instructions", async () => {
    for (const details of [true, false]) {
      const github = new FakeGitHub();
      github.on(`POST ${base}/actions/workflows/ci.yml/dispatches`, details ? json({ workflow_run_id: 4812, run_url: `${base}/actions/runs/4812`, html_url: "https://github.com/owner/repo/actions/runs/4812" }) : new Response(null, { status: 204 }));
      const agent = new GitHubAgent({ fetch: github.fetch, app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken() { /* No expiring token. */ }, status: () => ({ state: "not-configured" }) }, trust: { judge: () => Promise.resolve(() => true) }, resolveRepo: () => Promise.resolve({ slug: "owner/repo", everyone: true }) });
      const store = new ActionRunStore();
      const service = new ActionRunService({ github: agent, store, pulls: new PullRequestStore(), sessions: { inspect: ref => Promise.resolve({ ref, exists: true, available: true, settled: false, leaf: null }), wake: () => Promise.resolve("delivered") }, onError: error => { throw error; } });
      const deps = { read: (cwd: string, request: Parameters<GitHubAgent["read"]>[1]) => agent.read(cwd, request), write: (cwd: string, id: string, request: Parameters<GitHubAgent["write"]>[2]) => agent.write(cwd, id, request), actions: service };
      const [tool] = createGitHubActionsToolDefinitions("/workspace", deps);
      if (tool === undefined) throw new Error("Actions tool missing");
      expect(tool.exposure).toBe(MODEL_ONLY_EXPOSURE);
      expect(createPiWebCustomToolDefinitions("/workspace", false, undefined, undefined, undefined, deps).map(tool => tool.name)).toContain("github_actions");
      const result = await tool.execute("dispatch", { action: "dispatch", workflow: "ci.yml", ref: "main", inputs: { target: "linux" } }, undefined, undefined, ctx);
      expect(result.content[0]).toHaveProperty("text", details ? "Dispatched and linked run ID 4812.\nhttps://github.com/owner/repo/actions/runs/4812" : "Dispatch accepted, but GitHub returned no run details (HTTP 204). No run was linked. Find it with github_read runs and link it with github_actions link. Do not dispatch again.");
      expect(store.list()).toHaveLength(details ? 1 : 0);
      if (details) expect(store.list()[0]?.source).toBe("dispatch");
      expect(JSON.parse(github.requests[0]?.body ?? "null")).toEqual({ ref: "main", inputs: { target: "linux" }, return_run_details: true });
      expect(github.requests).toHaveLength(1);
      service.dispose();
    }
  });
  it("scopes link, unlink, watch and stop to the selected owned repository", async () => {
    const calls: unknown[] = [];
    const link = { provider: "github" as const, session: { id: "s1", cwd: "/repo-b" }, repo: "owner/b", runId: 1, source: "manual" as const, watch: { kind: "off" as const } };
    const [tool] = createGitHubActionsToolDefinitions("/repo-a", {
      read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }),
      target: (_ref, id) => id === "owned" ? Promise.resolve("/repo-b") : Promise.reject(new Error("Not owned")),
      actions: {
        link: (ref, run) => { calls.push(["link", ref, run]); return Promise.reject(new Error("Read refused")); },
        unlink: (ref, runId) => { calls.push(["unlink", ref, runId]); return Promise.resolve(link); },
        watch: (ref, runId) => { calls.push(["watch", ref, runId]); return Promise.resolve(link); },
        stopRef: (ref, runId) => { calls.push(["stop", ref, runId]); return Promise.resolve([link]); },
        dispatch: () => Promise.reject(new Error("Not used")),
      },
    });
    if (tool === undefined) throw new Error("Missing actions tool");
    await expect(tool.execute("link", { action: "link", run: "https://github.com/owner/b/actions/runs/1", worktreeId: "owned" }, undefined, undefined, ctx)).rejects.toThrow("Read refused");
    await tool.execute("unlink", { action: "unlink", runId: 1, worktreeId: "owned" }, undefined, undefined, ctx);
    await tool.execute("watch", { action: "watch", runId: 1, worktreeId: "owned" }, undefined, undefined, ctx);
    await tool.execute("stop", { action: "stop", worktreeId: "owned" }, undefined, undefined, ctx);
    await expect(tool.execute("bad", { action: "stop", worktreeId: "foreign" }, undefined, undefined, ctx)).rejects.toThrow("Not owned");
    expect(calls).toEqual([["link", link.session, "https://github.com/owner/b/actions/runs/1"], ["unlink", link.session, 1], ["watch", link.session, 1], ["stop", link.session, undefined]]);
    await expect(tool.execute("invalid", { action: "watch" }, undefined, undefined, ctx)).rejects.toThrow("runId");
  });
  it("passes runs/run filters through github_read", async () => {
    const reads: unknown[] = [];
    const [tool] = createGitHubToolDefinitions("/workspace", { read: (cwd, request) => { reads.push([cwd, request]); return Promise.resolve("runs"); }, write: () => Promise.resolve({ text: "" }) });
    await tool.execute("list", { action: "runs", branch: "main", headSha: "sha", workflow: "ci.yml", limit: 3 }, undefined, undefined, ctx);
    await tool.execute("read", { action: "run", runId: 4812 }, undefined, undefined, ctx);
    expect(reads).toEqual([["/workspace", { action: "runs", branch: "main", headSha: "sha", workflow: "ci.yml", limit: 3 }], ["/workspace", { action: "run", runId: 4812 }]]);
  });
});
