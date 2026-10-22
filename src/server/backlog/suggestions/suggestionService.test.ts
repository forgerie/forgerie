import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { Check } from "typebox/value";
import { Type } from "typebox";
import { GitHubIssueClient } from "../../github/githubIssues.js";
import type { Fetch } from "../../github/githubApp.js";
import { createGitHubBacklogProvider } from "../githubBacklog.js";
import { markdownBacklogProvider } from "../markdownBacklog.js";
import { GitHubAgent } from "../../github/githubAgent.js";
import { BacklogSuggestionSchema, type BacklogSuggestion, type BacklogSuggestionsResponse } from "../../../shared/backlogSuggestions.js";
import type { UserSessionStart } from "../../../shared/sessionWorktree.js";
import type { SessionInfo } from "../../../shared/apiTypes.js";
import { BacklogSuggestionService } from "./suggestionService.js";
import { BacklogSuggestionStore } from "./suggestionStore.js";
import { BacklogSettingsStore } from "../backlogSettingsStore.js";
import { BacklogService } from "../backlogService.js";
import { BacklogClaimStore } from "../backlogClaimStore.js";
import { registerBacklogSuggestionRoutes } from "./suggestionRoutes.js";
import { backlogScratchIdentity, backlogScratchIndexDirectory } from "./markdownScratch.js";
import { markdownSuggestionContent } from "./markdownWriter.js";
import { git, repository } from "./suggestionTestSupport.js";

const input = { title: "Improve launch recovery", body: "Keep the first prompt.", why: "A gap came up", files: ["src/launch.ts"], decisions: ["Use receipts"] };
const issue = (number: number, title: string, labels: string[] = []) => ({ number, title, body: "Existing", state: "open", html_url: `https://github.com/owner/repo/issues/${String(number)}`, user: { login: "owner" }, author_association: "OWNER", labels, created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", comments: 0 });
function inMemoryGitHub(gitResolution = false) {
  const writes: { url: string; body: unknown }[] = []; const labels = new Set<string>();
  const rows = [issue(7, "fix: Improve launch recovery")]; let listingReads = 0; let rejectCreation = false; let nextIssue = 20;
  const fetch: Fetch = (url, init) => {
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/search/issues")) return Promise.resolve(json({ total_count: 1, items: [rows[0]], incomplete_results: false }));
    if (method === "GET" && new URL(url).pathname.endsWith("/issues")) { listingReads++; return Promise.resolve(json(rows)); }
    if (method === "GET" && url.includes("/labels")) return Promise.resolve(json([...labels].map(name => ({ name, description: null }))));
    const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}"); writes.push({ url, body });
    if (url.endsWith("/labels")) { labels.add("agent-filed"); return Promise.resolve(json({ name: "agent-filed", description: "Agent filed" }, 201)); }
    if (url.endsWith("/issues") && Check(Type.Object({ title: Type.String(), labels: Type.Array(Type.String()), body: Type.String() }), body)) {
      const created = { ...issue(nextIssue++, body.title, body.labels), body: body.body }; rows.push(created);
      if (rejectCreation) { rejectCreation = false; return Promise.reject(new Error("Connection lost after GitHub accepted the issue")); }
      return Promise.resolve(json(created, 201));
    }
    throw new Error(`Unexpected in-memory API call ${method} ${url}`);
  };
  const agent = new GitHubAgent({ ...(gitResolution ? { backlogConfig: () => Promise.resolve({ providers: ["markdown" as const] }) } : { resolveRepo: () => Promise.resolve({ slug: "changed/repo", everyone: true }) }), trust: { judge: () => Promise.resolve(() => true) },
    app: { tokenFor: () => Promise.resolve({ ok: true, token: "memory" }), dropToken: () => undefined, status: () => ({ state: "not-configured" }) }, fetch,
  });
  const client = new GitHubIssueClient({ fetch, app: { tokenFor: () => Promise.resolve({ ok: true, token: "memory" }), dropToken: () => undefined, installUrl: () => undefined } });
  return { agent, client, writes, listingReads: () => listingReads, rejectNextCreation: () => { rejectCreation = true; } };
}
async function fixture() {
  const repo = await repository(); const events: BacklogSuggestion[] = [];
  const store = new BacklogSuggestionStore(join(repo.root, ".git/suggestions.json"), record => events.push(record)); await store.initialize();
  const settings = new BacklogSettingsStore(join(repo.root, ".git/settings.json"));
  const projects = { list: () => Promise.resolve([repo.project]), requireProject: () => Promise.resolve(repo.project) };
  const claims = new BacklogClaimStore(join(repo.root, ".git/claims.json")); await claims.initialize();
  const starts: UserSessionStart[] = []; const prompts: { id: string; text: unknown; requestId?: string | undefined }[] = [];
  let launchError = false; let promptError = false;
  const github = inMemoryGitHub();
  const backlog = new BacklogService({ projects, claims, settings, providers: [markdownBacklogProvider, createGitHubBacklogProvider({ issues: github.client })], userSessions: { start: start => {
    if (launchError) throw new Error("Configured launch failure");
    starts.push(start);
    const session: SessionInfo = { id: "background", cwd: repo.root, path: join(repo.root, ".git/background.jsonl"), created: "today", modified: "today", messageCount: 0, firstMessage: "" };
    return Promise.resolve(session);
  } }, sessions: { stop: () => Promise.resolve(), prompt: (ref, text, _behavior, _images, options) => { prompts.push({ id: ref.id, text, ...options }); return promptError ? Promise.reject(new Error("Configured prompt failure")) : Promise.resolve(); } }, isArchived: () => Promise.resolve(false) });
  const service = new BacklogSuggestionService({ store, projects, settings, worktrees: repo.worktrees, backlog, githubRepo: () => Promise.resolve("owner/repo"), fileIssue: async (cwd, sessionId, input, slug) => {
    const result = await github.agent.fileIssue(cwd, sessionId, input, slug);
    if (result.state === "created") await github.client.invalidate(result.repo);
    return result;
  } });
  return { ...repo, store, settings, service, starts, prompts, events, github, backlog, failLaunch: (fail: boolean) => { launchError = fail; }, failPrompt: (fail: boolean) => { promptError = fail; } };
}

describe("backlog suggestions", () => {
  it("resolves the first project-owned provider and model defaults once, and notes routed Azure sources", async () => {
    const f = await fixture();
    try {
      await f.settings.setSuggestionsDefault({ modelSpec: "global/cheap", thinkingLevel: "low" });
      await f.settings.save("project", { providers: ["github", "markdown"], github: { repo: "owner/pinned" }, suggestions: { modelSpec: "project/cheap" } }, 0);
      await f.settings.createSource({ organization: "org", project: "board", destinationProjectId: "project" });
      const record = await f.service.suggest(f.root, "chat", input, { sessionTitle: "Chat", modelSpec: "chat/large", thinkingLevel: "high" });
      expect(record.destination).toEqual({ provider: "github", repo: "owner/pinned", label: "agent-filed" });
      expect(record.defaultModel).toEqual({ modelSpec: "project/cheap", thinkingLevel: "low" }); expect(record.azureReadOnlyNote).toBe(true);
      await f.settings.save("project", { providers: ["markdown"] }, (await f.settings.read()).projects["project"]?.revision ?? 0);
      expect(f.service.list()[0]?.destination).toEqual(record.destination);
      expect((await f.service.suggest(f.root, "chat", input)).destination.provider).toBe("markdown");
    } finally { await f.dispose(); }
  });
  it("keeps repo-config suggestion defaults when retiring Azure, and falls back to the current chat model", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, ".forgerie"));
      await writeFile(join(f.root, ".forgerie/config.json"), JSON.stringify({ version: 1, backlog: { providers: ["azure-devops", "github"], suggestions: { thinkingLevel: "medium" } } }));
      const record = await f.service.suggest(f.root, "chat", input, { modelSpec: "chat/large", thinkingLevel: "high" });
      expect(record.destination).toEqual({ provider: "github", repo: "owner/repo", label: "agent-filed" });
      expect(record.defaultModel).toEqual({ modelSpec: "chat/large", thinkingLevel: "medium" });
    } finally { await f.dispose(); }
  });
  it("uses GitHub duplicate refusal, explicit File anyway, pinned repo, and agent-filed", async () => {
    const f = await fixture();
    try {
      await f.settings.save("project", { providers: ["github"] }, 0);
      const record = await f.service.suggest(f.root, "chat", input);
      const refused = await f.service.file(record.id, "file", { requestId: "refuse" });
      expect(refused.state).toMatchObject({ kind: "duplicate", matches: [{ number: 7 }] }); expect(f.github.writes).toEqual([]);
      const filed = await f.service.file(record.id, "file", { requestId: "anyway", notDuplicateOf: [7], body: "Different work after review" });
      expect(filed.state).toMatchObject({ kind: "filed", provider: "github", number: 20 });
      const write = f.github.writes.find(write => write.url.endsWith("/issues"));
      expect(write?.url).toBe("https://api.github.com/repos/owner/repo/issues");
      expect(write?.body).toMatchObject({ labels: ["agent-filed"], title: input.title });
      expect(JSON.stringify(write?.body)).toContain("## Context");
      expect(await f.service.file(record.id, "file", { requestId: "anyway", notDuplicateOf: [7], body: "Different work after review" })).toEqual(filed);
      expect(f.github.writes.filter(write => write.url.endsWith("/issues"))).toHaveLength(1);
      await expect(f.service.file(record.id, "file", { requestId: "anyway", title: "Changed" })).rejects.toThrow("reused");
    } finally { await f.dispose(); }
  });
  it("files to the stored GitHub repo even if current config and origin no longer supply a repo", async () => {
    const repo = await repository();
    try {
      const github = inMemoryGitHub(true);
      expect(await github.agent.fileIssue(repo.root, "chat", { title: input.title, body: input.body, duplicates: [input.title] }, "owner/pinned")).toMatchObject({ state: "duplicate", repo: "owner/pinned" });
    } finally { await repo.dispose(); }
  });
  it("launches a newly filed GitHub item even when its backlog list was already cached", async () => {
    const f = await fixture();
    try {
      await f.settings.save("project", { providers: ["github"], github: { repo: "owner/repo" } }, 0);
      expect((await f.backlog.list("everyone")).items).toHaveLength(1); expect(f.github.listingReads()).toBe(1);
      const record = await f.service.suggest(f.root, "chat", { ...input, title: "Export saved context as JSON" });
      const started = await f.service.file(record.id, "file-and-act", { requestId: "github-background" });
      expect(started.state).toMatchObject({ kind: "started", provider: "github", number: 20 });
      expect(f.starts).toHaveLength(1); expect(f.prompts[0]?.text).toContain("Keep the first prompt"); expect(f.github.listingReads()).toBe(2);
    } finally { await f.dispose(); }
  });
  it("files before background launch, sends the prompt from the server, and never starts a second session on a repeated request", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input, { modelSpec: "chat/large", thinkingLevel: "high" });
      const request = { requestId: "act", modelSpec: "override/cheap", thinkingLevel: "low" };
      const [started, repeated] = await Promise.all([f.service.file(record.id, "file-and-act", request), f.service.file(record.id, "file-and-act", request)]);
      expect(started).toEqual(repeated); expect(started.state).toMatchObject({ kind: "started", sessionId: "background", modelSpec: "override/cheap", thinkingLevel: "low" });
      expect(f.starts).toHaveLength(1); expect(f.starts[0]).toMatchObject({ destination: { kind: "fresh-worktree" }, modelSpec: "override/cheap" });
      expect(f.prompts).toHaveLength(1); expect(f.prompts[0]?.text).toContain("Use receipts"); expect(f.prompts[0]?.requestId).toMatch(/^backlog-/u);
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      expect(await readFile(join(f.root, record.destination.path), "utf8")).toContain("Keep the first prompt");
      const restartedStore = new BacklogSuggestionStore(join(f.root, ".git/suggestions.json")); await restartedStore.initialize();
      expect(restartedStore.receipt(record.id, "act")?.result).toEqual(started);
    } finally { await f.dispose(); }
  });
  it("keeps a filed receipt on launch failure; a new Start session request launches without filing again", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      // A saved suggestion remains launchable from its original directory after settings change.
      await f.settings.save("project", { providers: ["markdown"], dir: "different-backlog" }, 0);
      f.failLaunch(true);
      const failed = await f.service.file(record.id, "file-and-act", { requestId: "first" });
      expect(failed.state).toMatchObject({ kind: "filed", launchError: { message: "Configured launch failure", retryable: true } });
      f.failLaunch(false);
      const started = await f.service.file(record.id, "file-and-act", { requestId: "start-only" });
      expect(started.state.kind).toBe("started"); expect(f.starts).toHaveLength(1);
      expect(f.events.filter(record => record.state.kind === "filing")).toHaveLength(1);
    } finally { await f.dispose(); }
  });
  it("allocates and persists a new Markdown path for a closed same-title collision", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      const path = record.destination.path; await mkdir(join(f.root, ".forgerie/backlog"), { recursive: true });
      const closed = "---\nid: closed\ntitle: Improve launch recovery\nstatus: Done\nsource: manual\n---\nOld work\n";
      await writeFile(join(f.root, path), closed); await git(f.root, "add", path); await git(f.root, "commit", "-m", "closed item");
      const filed = await f.service.file(record.id, "file", { requestId: "new-path" });
      expect(filed.destination).toEqual({ provider: "markdown", path: path.replace(/\.md$/u, "-2.md") });
      expect(await readFile(join(f.root, path), "utf8")).toBe(closed);
      expect(f.events.some(event => event.state.kind === "filing" && event.destination.provider === "markdown" && event.destination.path.endsWith("-2.md"))).toBe(true);
      expect(await readFile(join(f.root, path.replace(/\.md$/u, "-2.md")), "utf8")).toContain(`source: forgerie-suggestion chat/${record.id}`);
    } finally { await f.dispose(); }
  });
  it.each([false, true])("recovers process death after scratch creation (fast-forward=%s), without leftovers or duplicate sessions", async afterFastForward => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      const request = { requestId: "crash", modelSpec: "override/cheap" };
      await f.store.update({ ...record, state: { kind: "filing", action: "file-and-act", launchChoice: { modelSpec: "override/stored", thinkingLevel: "medium" } } }, { suggestionId: record.id, requestId: "crash", fingerprint: "interrupted-fingerprint", action: "file-and-act", input: request });
      const scratch = backlogScratchIdentity(f.root, record.id);
      await git(f.root, "worktree", "add", "-b", scratch.branch, scratch.path, "main");
      await mkdir(join(scratch.path, ".forgerie/backlog"), { recursive: true });
      await writeFile(join(scratch.path, record.destination.path), markdownSuggestionContent(record, record.destination.path));
      await git(scratch.path, "add", record.destination.path); await git(scratch.path, "commit", "-m", "interrupted item write");
      if (afterFastForward) await git(f.root, "merge", "--ff-only", scratch.branch);
      const indexDirectory = await backlogScratchIndexDirectory(f.root, record.id); await mkdir(indexDirectory, { recursive: true }); await writeFile(join(indexDirectory, "item"), "private item bytes");
      // Simulate death before the state write: only the persisted filing record and Git artifacts survive.
      await f.store.initialize(); await f.service.recoverStartup();
      expect(await git(f.root, "branch", "--list", "forgerie-backlog-scratch/*")).toBe("");
      expect(await git(f.root, "worktree", "list", "--porcelain")).not.toContain(scratch.path);
      const recovered = f.store.require(record.id);
      expect(recovered.state).toMatchObject(afterFastForward ? { kind: "started", modelSpec: "override/stored", thinkingLevel: "medium" } : { kind: "failed", action: "file-and-act", retryable: true });
      await expect(readFile(join(indexDirectory, "item"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(f.store.pendingReceipt(record.id)).toBeUndefined();
      expect(f.starts).toHaveLength(afterFastForward ? 1 : 0);
      await f.service.recoverStartup(); expect(f.starts).toHaveLength(afterFastForward ? 1 : 0);
    } finally { await f.dispose(); }
  });
  it("does not recover or launch an unrelated closed item, and sweeps orphan private scratch without touching ordinary worktrees", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      await mkdir(join(f.root, ".forgerie/backlog"), { recursive: true });
      await writeFile(join(f.root, record.destination.path), "---\nid: closed\ntitle: Improve launch recovery\nstatus: Done\nsource: manual\n---\nUnrelated\n");
      await git(f.root, "add", record.destination.path); await git(f.root, "commit", "-m", "unrelated closed item");
      await f.store.update({ ...record, state: { kind: "filing", action: "file-and-act" } }, { suggestionId: record.id, requestId: "crash", fingerprint: "fp", action: "file-and-act", input: { requestId: "crash" } });
      const orphan = backlogScratchIdentity(f.root, "orphan");
      await git(f.root, "worktree", "add", "-b", orphan.branch, orphan.path, "main");
      const ordinary = join(f.root, ".worktrees/ordinary"); await git(f.root, "worktree", "add", "-b", "keep-ordinary", ordinary, "main");
      await f.store.initialize(); await f.service.recoverStartup();
      expect(f.store.require(record.id).state).toMatchObject({ kind: "failed", action: "file-and-act", retryable: true }); expect(f.starts).toEqual([]);
      expect(await git(f.root, "branch", "--list", "forgerie-backlog-scratch/*")).toBe("");
      expect(await git(f.root, "worktree", "list", "--porcelain")).toContain(ordinary);
      expect(await git(f.root, "branch", "--list", "keep-ordinary")).toContain("keep-ordinary");
    } finally { await f.dispose(); }
  });
  it.each(["file", "file-and-act"] as const)("remembers a failed %s action and supports retry after reload", async action => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      await git(f.root, "switch", "-c", "other");
      const failed = await f.service.file(record.id, action, { requestId: "fail" });
      expect(failed.state).toMatchObject({ kind: "failed", action, retryable: true });
      await f.store.initialize(); expect(f.store.require(record.id).state).toEqual(failed.state);
      await git(f.root, "switch", "main");
      const retry = await f.service.file(record.id, action, { requestId: "retry" });
      expect(retry.state.kind).toBe(action === "file-and-act" ? "started" : "filed");
      expect(f.starts).toHaveLength(action === "file-and-act" ? 1 : 0);
    } finally { await f.dispose(); }
  });
  it("files Markdown after acknowledging every matching path, but refuses a new unacknowledged match", async () => {
    const f = await fixture(); const app = Fastify(); registerBacklogSuggestionRoutes(app, f.service);
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      const firstPath = record.destination.path; const newPath = ".forgerie/backlog/new.md";
      await mkdir(join(f.root, ".forgerie/backlog"), { recursive: true });
      await writeFile(join(f.root, firstPath), "---\nid: first\ntitle: Improve launch recovery\nstatus: To Do\n---\nExisting\n");
      await git(f.root, "add", firstPath); await git(f.root, "commit", "-m", "existing match");
      const click = async (action: string, payload: object) => {
        const response = await app.inject({ method: "POST", url: `/backlog/suggestions/${record.id}/${action}`, payload });
        expect(response.statusCode, response.body).toBe(200); return response.json<BacklogSuggestion>();
      };
      expect((await click("file", { requestId: "duplicate" })).state).toMatchObject({ kind: "duplicate", matches: [{ path: firstPath }] });
      await writeFile(join(f.root, newPath), "---\nid: new\ntitle: Improve launch recovery\nstatus: To Do\n---\nNew match\n");
      await git(f.root, "add", newPath); await git(f.root, "commit", "-m", "new match while card was open");
      const refused = await click("file", { requestId: "new-match", acknowledgedPaths: [firstPath] });
      expect(refused.state.kind).toBe("duplicate");
      if (refused.state.kind !== "duplicate") throw new Error("Expected duplicate refusal");
      expect(refused.state.matches.map(match => match.path)).toContain(newPath);
      const filed = await click("file-and-act", { requestId: "acknowledged", acknowledgedPaths: [firstPath, newPath] });
      expect(filed.state.kind).toBe("started"); expect(f.starts).toHaveLength(1);
      expect(filed.destination).toEqual({ provider: "markdown", path: firstPath.replace(/\.md$/u, "-2.md") });
      expect(await click("file-and-act", { requestId: "acknowledged", acknowledgedPaths: [newPath, firstPath] })).toEqual(filed); expect(f.starts).toHaveLength(1);
    } finally { await app.close(); await f.dispose(); }
  });
  it("reuses the created session after prompt failure even if retry overrides choose another model", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input, { modelSpec: "source/current", thinkingLevel: "high" });
      f.failPrompt(true);
      const failed = await f.service.file(record.id, "file-and-act", { requestId: "prompt-fails", modelSpec: "override/first", thinkingLevel: "low" });
      expect(failed.state).toMatchObject({ kind: "filed", launchChoice: { modelSpec: "override/first", thinkingLevel: "low" }, launchError: { retryable: true } });
      expect(f.events.some(event => event.state.kind === "filing" && event.state.launchChoice?.modelSpec === "override/first")).toBe(true); expect(f.starts).toHaveLength(1);
      await f.store.initialize(); f.failPrompt(false);
      const retry = await f.service.file(record.id, "file-and-act", { requestId: "prompt-retry", modelSpec: "override/different", thinkingLevel: "off" });
      expect(retry.state).toMatchObject({ kind: "started", sessionId: "background", modelSpec: "override/first", thinkingLevel: "low" });
      expect(f.starts).toHaveLength(1); expect(f.prompts).toHaveLength(2); expect(f.prompts[1]?.requestId).toBe(f.prompts[0]?.requestId);
    } finally { await f.dispose(); }
  });
  it("replays a completed launch retry without an override after prompt failure and reload", async () => {
    const f = await fixture();
    try {
      const record = await f.service.suggest(f.root, "chat", input, { modelSpec: "source/current", thinkingLevel: "high" });
      f.failPrompt(true);
      expect((await f.service.file(record.id, "file-and-act", { requestId: "initial-override", modelSpec: "override/first", thinkingLevel: "low" })).state.kind).toBe("filed");
      await f.store.initialize(); f.failPrompt(false);
      const request = { requestId: "retry-without-override" };
      const started = await f.service.file(record.id, "file-and-act", request);
      expect(started.state).toMatchObject({ kind: "started", sessionId: "background", modelSpec: "override/first", thinkingLevel: "low" });
      await f.store.initialize();
      expect(await f.service.file(record.id, "file-and-act", request)).toEqual(started);
      expect(f.starts).toHaveLength(1); expect(f.prompts).toHaveLength(2);
    } finally { await f.dispose(); }
  });
  it("restores an unsafe GitHub failure to the same failed state, never to a fileable open state", async () => {
    const f = await fixture();
    try {
      await f.settings.save("project", { providers: ["github"], github: { repo: "owner/repo" } }, 0);
      const record = await f.service.suggest(f.root, "chat", { ...input, title: "Export lost receipt context" });
      f.github.rejectNextCreation();
      const failed = await f.service.file(record.id, "file", { requestId: "unknown-receipt" });
      expect(failed.state).toMatchObject({ kind: "failed", action: "file", retryable: false });
      await f.service.transition(record.id, "dismiss"); await f.store.initialize();
      const restored = await f.service.transition(record.id, "restore"); expect(restored.state).toEqual(failed.state);
      await expect(f.service.file(record.id, "file", { requestId: "must-not-refile", title: "Changed title after unsafe failure" })).rejects.toMatchObject({ kind: "conflict" });
      expect(f.github.writes.filter(write => write.url.endsWith("/issues"))).toHaveLength(1);
    } finally { await f.dispose(); }
  });
  it("validates complete content before filing, so an oversized override leaves the card open", async () => {
    const f = await fixture();
    try {
      await f.settings.save("project", { providers: ["github"] }, 0);
      const record = await f.service.suggest(f.root, "chat", { ...input, decisions: ["x".repeat(4096), "x".repeat(4096), "x".repeat(4096), "x".repeat(4096), "x".repeat(4096)] });
      await expect(f.service.file(record.id, "file", { requestId: "too-large", body: "x".repeat(48000) })).rejects.toMatchObject({ kind: "invalid-request" });
      expect(f.store.require(record.id).state.kind).toBe("open"); expect(f.github.writes).toEqual([]);
    } finally { await f.dispose(); }
  });
  it("serves typed routes, filters records, and rejects wrong states and malformed bodies with BacklogError", async () => {
    const f = await fixture(); const app = Fastify(); registerBacklogSuggestionRoutes(app, f.service, "/api");
    try {
      const record = await f.service.suggest(f.root, "chat", input);
      const url = `/api/backlog/suggestions/${record.id}`;
      expect((await app.inject({ method: "POST", url: `${url}/restore`, payload: {} })).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: `${url}/dismiss`, payload: { unexpected: true } })).statusCode).toBe(400);
      const dismissed = await app.inject({ method: "POST", url: `${url}/dismiss`, payload: {} });
      expect(dismissed.statusCode).toBe(200); expect(Check(BacklogSuggestionSchema, dismissed.json())).toBe(true);
      const list = await app.inject({ url: "/api/backlog/suggestions?sessionId=chat&state=dismissed" }); expect(list.json<BacklogSuggestionsResponse>().suggestions).toHaveLength(1);
      expect((await app.inject({ url: "/api/backlog/suggestions?sessionId=another" })).json()).toEqual({ suggestions: [] });
      expect((await app.inject({ url: "/api/backlog/suggestions?state=unknown" })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: `${url}/file`, payload: { requestId: "wrong" } })).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: `${url}/restore`, payload: {} })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `${url}/file`, payload: { requestId: "file", modelSpec: "not/accepted" } })).statusCode).toBe(400);
      const filed = await app.inject({ method: "POST", url: `${url}/file`, payload: { requestId: "file" } });
      expect(filed.statusCode).toBe(200); expect(filed.json<BacklogSuggestion>().state.kind).toBe("filed"); expect(f.starts).toEqual([]); expect(f.prompts).toEqual([]);
      expect((await app.inject({ method: "POST", url: `${url}/file`, payload: { requestId: "again" } })).json()).toMatchObject({ kind: "conflict" });
      expect((await app.inject({ method: "POST", url: `${url}/file`, payload: { requestId: "file" } })).json()).toEqual(filed.json());
    } finally { await app.close(); await f.dispose(); }
  });
});
