import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { projectBrowserMessageResponse, projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { GitHubAgent } from "../github/githubAgent.js";
import { issue, json } from "../github/fakeGitHub.testSupport.js";
import { readLegacyIssueEntry } from "../../shared/legacyIssueProposals.js";

it("files through the hosted tool, logs a parent issue decision, and reopens the decision and tool result", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-file-issue-"));
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const input = { title: "Retry children", body: "Details", duplicates: ["child retry", "retry state:closed"], worktreeId: "owned-b" };
  provider.setResponses(Array.from({ length: 20 }, () => context => {
    const last = context.messages.at(-1);
    return last?.role === "user" && JSON.stringify(last.content).includes("File the issue.")
      ? fauxAssistantMessage([fauxToolCall("file_issue", input)], { stopReason: "toolUse" })
      : fauxAssistantMessage("Filed. Continue work.");
  }));
  const calls: unknown[] = [];
  let distinct = false;
  const open = () => new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
    github: { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }),
      target: (ref, id) => { calls.push([ref, id]); return Promise.resolve("/secondary"); },
      fileIssue: (cwd, id, received) => { calls.push([cwd, id, received]);
        if (!distinct) return Promise.resolve({ state: "duplicate", repo: "owner/secondary", matches: [{ number: 8, title: input.title, state: "closed", url: "https://github.com/owner/secondary/issues/8" }] });
        return Promise.resolve({ state: "created", repo: "owner/secondary", number: 9, title: received.title, url: "https://github.com/owner/secondary/issues/9", agentFiled: true }); },
    },
  });
  let service = open();
  try {
    const ref = { id: (await service.start(root, { initialModelSpec: "faux/faux-1" })).id, cwd: root };
    await service.prompt(ref, "File the issue.");
    await vi.waitFor(async () => {
      expect(JSON.stringify((await service.messages(ref)).messages)).toContain('"state":"duplicate"');
      expect((await service.status(ref)).isStreaming).toBe(false);
    });
    expect(await service.decisions(ref)).toEqual([]);
    calls.length = 0; distinct = true;
    await service.prompt(ref, "File the issue.");
    await vi.waitFor(async () => { expect(await service.decisions(ref), JSON.stringify((await service.messages(ref)).messages)).toHaveLength(1); expect((await service.status(ref)).isStreaming).toBe(false); }, { timeout: 2000 });
    expect(calls).toEqual([[ref, "owned-b"], ["/secondary", ref.id, { title: input.title, body: input.body, duplicates: input.duplicates }]]);
    expect(await service.decisions(ref)).toMatchObject([{ id: "issue:owner/secondary:9", kind: "issue", by: "parent", question: input.title, choice: "#9 https://github.com/owner/secondary/issues/9", reason: "Searches run: child retry; retry state:closed", flagged: false, state: { kind: "standing" } }]);
    await service.dispose(); service = open();
    expect(await service.decisions(ref)).toHaveLength(1);
    expect(JSON.stringify((await service.messages(ref)).messages)).toContain('"toolName":"file_issue"');
    expect(JSON.stringify((await service.messages(ref)).messages)).toContain('"agentFiled":true');
    expect(calls).toHaveLength(2);
    // Reopen did not start a model turn.
    await sleep(10);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 10000);

it("logs a known created issue once before returning its missing-label error through the hosted tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-file-issue-label-error-"));
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const input = { title: "Export decision log", body: "Add JSON export", duplicates: ["decision log export state:all"] };
  provider.setResponses(Array.from({ length: 20 }, () => context => {
    const last = context.messages.at(-1);
    return last?.role === "user" && JSON.stringify(last.content).includes("File the issue.")
      ? fauxAssistantMessage([fauxToolCall("file_issue", input)], { stopReason: "toolUse" })
      : fauxAssistantMessage("The user must repair the label. I will not file it again.");
  }));
  const repo = "https://api.github.com/repos/owner/repo";
  const url = "https://github.com/owner/repo/issues/201";
  const posts: string[] = [];
  const github = new GitHubAgent({
    resolveRepo: () => Promise.resolve({ slug: "owner/repo", everyone: true }),
    app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken: () => undefined, status: () => ({ state: "not-configured" }) },
    trust: { judge: () => Promise.resolve(() => true) },
    fetch: async (requestUrl, init) => {
      await Promise.resolve();
      if (init?.method === "POST") posts.push(requestUrl);
      if (requestUrl.startsWith("https://api.github.com/search/issues")) return json({ total_count: 0, items: [], incomplete_results: false });
      if (requestUrl.startsWith(`${repo}/labels`) && init?.method === "GET") return json([{ name: "agent-filed", description: null }]);
      if (requestUrl === `${repo}/issues` && init?.method === "POST") {
        if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
        expect(JSON.parse(init.body)).toMatchObject({ labels: ["agent-filed"] });
        return json(issue(201, { title: input.title, html_url: url, state: "open", updated_at: "2026-10-13T00:00:00Z", comments: 0, labels: [] }), { status: 201 });
      }
      throw new Error(`Unexpected GitHub request ${requestUrl}`);
    },
  });
  const open = () => new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
    github: { read: (cwd, request) => github.read(cwd, request), write: (cwd, id, request) => github.write(cwd, id, request), fileIssue: (cwd, id, request) => github.fileIssue(cwd, id, request) },
  });
  let service = open();
  try {
    const ref = { id: (await service.start(root, { initialModelSpec: "faux/faux-1" })).id, cwd: root };
    await service.prompt(ref, "File the issue.");
    await vi.waitFor(async () => {
      expect(JSON.stringify((await service.messages(ref)).messages)).toContain("Do not file it again");
      expect((await service.status(ref)).isStreaming).toBe(false);
    }, { timeout: 5000 });
    expect(posts).toEqual([`${repo}/issues`]);
    const records = await service.decisions(ref);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "issue:owner/repo:201", kind: "issue", by: "parent", question: input.title, choice: `#201 ${url}`, flagged: false });
    const row = (await service.messages(ref)).messages.find(message => typeof message === "object" && message !== null && "toolName" in message && message.toolName === "file_issue");
    expect(row).toMatchObject({ isError: true, details: { state: "created", number: 201, url, agentFiled: false } });
    expect(row).toHaveProperty("details.labelWarning", expect.stringContaining("did not attach"));
    expect(JSON.stringify(row)).toContain(url);
    expect(JSON.stringify(row)).toContain("Do not file it again");
    await service.dispose(); service = open();
    expect(await service.decisions(ref)).toHaveLength(1);
    expect(JSON.stringify((await service.messages(ref)).messages)).toContain('"agentFiled":false');
    expect(posts).toEqual([`${repo}/issues`]);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 10000);

it("keeps old proposal and outcome details unchanged as plain custom messages, including malformed old entries", () => {
  const proposal = { role: "custom", customType: "forgerie.issue-proposal", content: "Proposed issue p1 on o/r: Fix", details: { proposal: { proposalId: "p1", repo: "o/r", title: "Fix", body: "Details", labels: [] }, targetCwd: "/repo" } };
  const outcome = { role: "custom", customType: "forgerie.issue-proposal-outcome", content: "Created #9", details: { proposalId: "p1", outcome: { state: "created", number: 9, title: "Fix", url: "https://github.com/o/r/issues/9" } } };
  const dismissed = { ...outcome, details: { proposalId: "p1", outcome: { state: "dismissed" } } };
  const malformed = { ...proposal, details: null };
  for (const entry of [proposal, outcome, dismissed, malformed]) {
    const page = { messages: [entry], start: 0, total: 1 };
    expect(projectBrowserMessageResponse(page)).toBe(page);
    expect(projectBrowserSessionEvent({ type: "message.end", message: entry })).toEqual({ type: "message.end", message: entry });
    expect(readLegacyIssueEntry(entry.customType, entry.details)).toBe(entry === malformed ? undefined : entry.details);
  }
});
