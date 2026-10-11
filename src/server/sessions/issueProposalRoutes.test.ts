import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { Check } from "typebox/value";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { registerIssueProposalRoutes } from "./issueProposalRoutes.js";
import { GitHubAgent } from "../github/githubAgent.js";
import { FakeGitHub, issue, json } from "../github/fakeGitHub.testSupport.js";
import { ISSUE_PROPOSAL_OUTCOME_TYPE, ISSUE_PROPOSAL_TYPE, IssueProposalRecordSchema } from "../../shared/issueProposals.js";

const repo = "https://api.github.com/repos/owner/repo";
const input = { title: "Fix", body: "Details", labels: ["bug"] };
let root: string;
let service: PiSessionService;
let server: FastifyInstance;
let events: CapturingSessionEventHub;
let github: FakeGitHub;
let models: ModelRuntime;
let provider: ReturnType<typeof fauxProvider>;
let openService: () => PiSessionService;
let ref: { id: string; cwd: string };
const url = (id: string, decision = "create") => `/api/sessions/${ref.id}/issue-proposals/${id}/${decision}`;
const outcome = { state: "created", number: 38, title: "Fix", url: "https://github.com/owner/repo/issues/38" };
const messages = () => service.messages(ref).then((page) => page.messages);
const custom = (type: string) => messages().then((rows) => rows.filter((row) => typeof row === "object" && row !== null && "customType" in row && row.customType === type));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-issue-proposals-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  provider = fauxProvider({ tokensPerSecond: 10000, models: [{ id: "issue-test" }] });
  models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage([fauxText("Ready.")])));
  github = new FakeGitHub();
  github.always(`GET ${repo}`, json({ default_branch: "main" }));
  github.on(`GET ${repo}/labels`, ...Array.from({ length: 20 }, () => json([{ name: "bug", description: null }])));
  github.always(`POST ${repo}/issues`, json(issue(38, { title: "Fix", state: "open", updated_at: "2026-10-07T00:00:00Z", comments: 0, html_url: outcome.url })));
  const agent = new GitHubAgent({ fetch: github.fetch, app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken() { /* Test tokens do not expire. */ }, status: () => ({ state: "not-configured" }) },
    trust: { judge: () => Promise.resolve(() => true) }, resolveRepo: () => Promise.resolve({ slug: "owner/repo", everyone: true }) });
  events = new CapturingSessionEventHub();
  openService = () => new PiSessionService(events, { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60000,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
    github: { read: (cwd, request) => agent.read(cwd, request), write: (cwd, id, request) => agent.write(cwd, id, request),
      prepareIssue: (cwd, request) => agent.prepareIssue(cwd, request), createIssue: (slug, id, request) => agent.createIssue(slug, id, request) },
  });
  service = openService();
  ref = { id: (await service.start(root, { initialModelSpec: "faux/issue-test" })).id, cwd: root };
  await service.prompt(ref, "Seed the transcript.");
  while (!events.sessionEvents.some(({ event }) => event.type === "agent.end")) await sleep(20);
  events.sessionEvents.length = 0;
  server = Fastify();
  registerIssueProposalRoutes(server, { decideIssueProposal: (...args) => service.decideIssueProposal(...args) }, "/api");
});
afterEach(async () => { await server.close(); await service.dispose(); await rm(root, { recursive: true, force: true }); });

describe("issue proposal HTTP decisions in hosted Durable sessions", () => {
  it("creates once, streams the outcome without a turn, and restores it from disk", async () => {
    const proposal = await service.proposeIssue(ref, root, input);
    const replies = await Promise.all([server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } }), server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } })]);
    expect(replies.map((response) => response.statusCode)).toEqual([200, 409]);
    expect(replies[0].json()).toEqual(outcome);
    expect(replies[1].json()).toMatchObject({ outcome });
    expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(await custom(ISSUE_PROPOSAL_OUTCOME_TYPE)).toHaveLength(1);
    expect(events.sessionEvents.some(({ event }) => event.type === "message.end" && typeof event.message === "object" && event.message !== null && "customType" in event.message && event.message.customType === ISSUE_PROPOSAL_OUTCOME_TYPE)).toBe(true);
    expect(events.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(0);
    await service.dispose();
    service = openService();
    const replay = await server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ outcome });
    expect(await custom(ISSUE_PROPOSAL_TYPE)).toHaveLength(1);
  });
  it("does not record a GitHub failure and lets the card retry", async () => {
    github.on(`POST ${repo}/issues`, json({ message: "GitHub unavailable" }, { status: 503 }), json(issue(38, { title: "Fix", state: "open", updated_at: "2026-10-07T00:00:00Z", comments: 0, html_url: outcome.url })));
    const proposal = await service.proposeIssue(ref, root, input);
    const failed = await server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: "GitHub refused (HTTP 503): GitHub unavailable" });
    expect(await custom(ISSUE_PROPOSAL_OUTCOME_TYPE)).toHaveLength(0);
    await service.dispose();
    service = openService();
    expect(await custom(ISSUE_PROPOSAL_TYPE)).toHaveLength(1);
    expect(await custom(ISSUE_PROPOSAL_OUTCOME_TYPE)).toHaveLength(0);
    expect((await server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } })).json()).toEqual(outcome);
  });
  it("dismisses without a GitHub write and rejects a later create", async () => {
    const proposal = await service.proposeIssue(ref, root, input);
    expect((await server.inject({ method: "POST", url: url(proposal.proposalId, "dismiss"), payload: { cwd: root } })).json()).toEqual({ state: "dismissed" });
    const create = await server.inject({ method: "POST", url: url(proposal.proposalId), payload: { cwd: root } });
    expect(create.statusCode).toBe(409);
    expect(create.json()).toMatchObject({ outcome: { state: "dismissed" } });
    expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });
  it("returns 404 for unknown and foreign proposals", async () => {
    const proposal = await service.proposeIssue(ref, root, input);
    const foreign = await service.start(root);
    expect((await server.inject({ method: "POST", url: url("unknown"), payload: { cwd: root } })).statusCode).toBe(404);
    expect((await server.inject({ method: "POST", url: `/api/sessions/${foreign.id}/issue-proposals/${proposal.proposalId}/create`, payload: { cwd: root } })).statusCode).toBe(404);
  });
  it.each([{}, { cwd: "" }, { cwd: "relative" }, { cwd: "/repo", extra: true }, { cwd: 4 }, null])("rejects invalid bodies: %j", async (payload) => {
    for (const decision of ["create", "dismiss"]) expect((await server.inject({ method: "POST", url: url("p1", decision), payload: JSON.stringify(payload), headers: { "content-type": "application/json" } })).statusCode).toBe(400);
  });
  it("runs propose_issue without ending the turn and streams a decision while the agent keeps working", async () => {
    let nextTurnText = "";
    provider.setResponses(Array.from({ length: 20 }, () => (context) => {
      const last = context.messages.at(-1);
      const text = JSON.stringify(last?.content);
      if (last?.role === "user" && text.includes("Propose this issue")) return fauxAssistantMessage([fauxToolCall("propose_issue", input)], { stopReason: "toolUse" });
      const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
      if (result?.role === "toolResult" && result.toolName === "propose_issue" && !(last?.role === "user" && text.includes("Read the outcome"))) return fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 1" })], { stopReason: "toolUse" });
      if (last?.role === "user" && text.includes("Read the outcome")) nextTurnText = JSON.stringify(context.messages);
      return fauxAssistantMessage([fauxText("I kept working.")]);
    }));
    await service.prompt(ref, "Propose this issue and keep working.");
    const deadline = Date.now() + 10000;
    while (!events.sessionEvents.some(({ event }) => event.type === "tool.start" && event.toolName === "bash")) {
      if (Date.now() > deadline) throw new Error("Agent did not continue after propose_issue");
      await sleep(20);
    }
    const rows = await custom(ISSUE_PROPOSAL_TYPE);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (typeof row !== "object" || row === null || !("details" in row) || !Check(IssueProposalRecordSchema, row.details)) throw new Error("Proposal data missing");
    const proposalId = row.details.proposal.proposalId;
    const before = events.sessionEvents.filter(({ event }) => event.type === "agent.start").length;
    const response = await server.inject({ method: "POST", url: url(proposalId), payload: { cwd: root } });
    expect(response.statusCode).toBe(200);
    expect((await service.status(ref)).isStreaming).toBe(true);
    expect(await custom(ISSUE_PROPOSAL_OUTCOME_TYPE)).toHaveLength(1);
    expect(events.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(before);
    while ((await service.status(ref)).isStreaming) await sleep(20);
    await service.prompt(ref, "Read the outcome.");
    while (nextTurnText === "") await sleep(20);
    while ((await service.status(ref)).isStreaming) await sleep(20);
    expect(nextTurnText).toContain("The user created issue #38 from proposal");
  }, 15000);
});
