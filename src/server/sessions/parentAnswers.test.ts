import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { registerDecisionRoutes } from "./decisionRoutes.js";
import { createDurableChildHost, LiveChildSessionIndex } from "./durableChildHost.js";

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Expected a value");
  return value;
}
const questionId = (message: string | undefined) => required(/asks ([^\]]+)/.exec(required(message))?.[1]);
let root: string;
let service: PiSessionService;
let models: ModelRuntime;
let hub: CapturingSessionEventHub;
let mode = "answer";
let busy = false;
let releaseBusy: (() => void) | undefined;
let parentQuestions: string[] = [];
const text = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part: {text?: string}) => part.text ?? "").join("") : "";
function open(host = true) {
  hub = new CapturingSessionEventHub();
  return new PiSessionService(hub, { agentDir: join(root, "agent"), modelRuntime: models, archiveStore: emptyArchiveStore(),
    sessionManager: createPiSessionManagerGateway({ agentDir: join(root, "agent"), env: { HOME: root }, sessionDirEnvKeys: [] }),
    ...(host ? { durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "live.json")) }) } : {}) });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-parent-answers-")); await mkdir(join(root, "agent"));
  mode = "answer"; busy = false; releaseBusy = undefined; parentQuestions = [];
  models = await ModelRuntime.create({ authPath: join(root, "agent/auth.json"), modelsPath: join(root, "agent/models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 200 }, () => async (request) => {
    const last = [...request.messages].reverse().find((message) => message.role !== "system"); const said = text(last?.content);
    const call = (name: string, args: Record<string, string | boolean>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
    if (said === "Start") return call("child_agent", { action: "spawn", name: "helper", message: "Ask", isolation: "shared" });
    if (last?.role === "toolResult" && said.startsWith("Started") && busy) await new Promise<void>((resolve) => { releaseBusy = resolve; });
    if (said.startsWith("RECORD ")) return call("record_decision", { question: "Can I proceed?", choice: "Proceed", reason: "Cannot find an answer anywhere", guess: said === "RECORD true" });
    if (said.startsWith("REPLY ")) return call("child_agent", { action: "answer", name: "helper", questionId: said.slice(6), answer: "TASK-VALUE", reason: "The task specifies it" });
    if (last?.role === "toolResult" && said === "The parent answered: TASK-VALUE" && mode === "live") return call("ask_human", { question: "Second question" });
    if (said === "Ask") return call("ask_human", { question: "Which value from the task?" });
    const question = /^\[child helper asks ([^\]]+)\]/.exec(said);
    if (question) {
      parentQuestions.push(said);
      if (said.includes("Second question")) return fauxAssistantMessage("I will answer later");
      return mode === "answer" || mode === "live" ? call("child_agent", { action: "answer", name: "helper", questionId: required(question[1]), answer: "TASK-VALUE", reason: "The task specifies it" })
      : mode === "hold" ? fauxAssistantMessage("I will answer later") : call("child_agent", { action: "escalate", questionId: required(question[1]), kind: mode, guess: "TASK-GUESS", why: "Escalation reason" });
    }
    return fauxAssistantMessage(last?.role === "toolResult" && /answer|answered/i.test(said) ? `Finished: ${said}` : "Done");
  }));
  service = open();
});
afterEach(async () => { releaseBusy?.(); await service.dispose(); await rm(root, { recursive: true, force: true }); });
const start = async () => { const ref = { id: (await service.start(root)).id, cwd: root }; await service.prompt(ref, "Start"); return ref; };
it("routes a child's question to its parent, answers without a card, and logs the reason", async () => {
  const ref = await start();
  await vi.waitFor(async () => { expect(await service.decisions(ref)).toMatchObject([{ kind: "child-answer", by: "parent", choice: "TASK-VALUE", reason: "The task specifies it", flagged: false, state: { kind: "standing" } }]); });
  const child = required((await service.durableChildren(ref))[0]);
  await vi.waitFor(async () => { expect(JSON.stringify(await service.durableChildMessages(ref, child.conversationId))).toContain("The parent answered: TASK-VALUE"); });
  expect((await service.status(ref)).waitingOnYou).toBeUndefined();
  const transcript = JSON.stringify((await service.messages(ref, {limit: 200})).messages);
  expect(transcript).toContain("[child helper asks q:"); expect(transcript).not.toContain("forgerie.child-question");
  expect(hub.sessionEvents.some(({event}) => JSON.stringify(event).includes("workflow_runs_changed"))).toBe(true);
});

it.each(["irreversible", "external"])("escalates %s as a user card with the parent's guess and logs the user's answer", async (kind) => {
  mode = kind; const ref = await start();
  await vi.waitFor(async () => { expect((await service.status(ref)).waitingOnYou).toBe(1); });
  const child = required((await service.durableChildren(ref))[0]);
  const question = required(child.questions[0]);
  expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain('"guess":"TASK-GUESS"');
  expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain('"why":"Escalation reason"');
  expect(await service.decisions(ref)).toEqual([]);
  expect(JSON.stringify(await service.durableChildMessages(ref, child.conversationId))).not.toContain("The user answered:");
  await service.answerDurableChildQuestion(ref, question.questionId, "USER-VALUE");
  await vi.waitFor(async () => { expect(JSON.stringify(await service.durableChildMessages(ref, child.conversationId))).toContain("The user answered: USER-VALUE"); });
  expect(await service.decisions(ref)).toMatchObject([{kind: "child-answer", by: "user", choice: "USER-VALUE", flagged: false}]);
  await vi.waitFor(async () => { expect((await service.status(ref)).waitingOnYou).toBeUndefined(); });
});
it.each(["contradicts", "stuck"])("gives a provisional %s guess without a card, flags it, and clears the flag on overturn", async (kind) => {
  mode = kind; const ref = await start();
  await vi.waitFor(async () => { expect((await service.status(ref)).flaggedDecisions).toBe(1); });
  const child = required((await service.durableChildren(ref))[0]);
  await vi.waitFor(async () => { expect(JSON.stringify(await service.durableChildMessages(ref, child.conversationId))).toContain("Provisional answer from the parent, which the user may overturn: TASK-GUESS"); });
  const [decision] = await service.decisions(ref);
  expect(decision).toMatchObject({kind: "guess", flagged: true, choice: "TASK-GUESS", reason: "Escalation reason"});
  expect((await service.status(ref)).waitingOnYou).toBeUndefined();
  expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).not.toContain("forgerie.child-question");
  await service.dispose(); service = open();
  expect((await service.status(ref)).flaggedDecisions).toBe(1);
  await service.overturnDecision(ref, required(decision).id, "Use a different value");
  await vi.waitFor(async () => { expect((await service.status(ref)).flaggedDecisions).toBeUndefined(); });
});
it("queues a busy parent's question as one follow-up, rather than steering its active work", async () => {
  busy = true; const ref = await start();
  await vi.waitFor(() => { expect(releaseBusy).toBeTypeOf("function"); });
  const child = required((await service.durableChildren(ref))[0]);
  await vi.waitFor(async () => { expect(JSON.stringify(await service.durableChildMessages(ref, child.conversationId))).toContain("ask_human"); });
  await sleep(300);
  expect(parentQuestions).toEqual([]); expect(await service.decisions(ref)).toEqual([]);
  expect((await service.status(ref)).waitingOnYou).toBeUndefined();
  releaseBusy?.();
  await vi.waitFor(async () => { expect(await service.decisions(ref)).toHaveLength(1); });
  expect(parentQuestions).toHaveLength(1);
});
it("keeps one parent routing receipt across restart, rejects a user answer before escalation, and preserves the eventual answer", async () => {
  mode = "hold"; const ref = await start();
  await vi.waitFor(() => { expect(parentQuestions).toHaveLength(1); });
  await vi.waitFor(() => { expect(hub.sessionEvents.filter(({event}) => event.type === "agent.end").length).toBeGreaterThanOrEqual(2); });
  const qid = questionId(parentQuestions[0]);
  expect((await service.durableChildren(ref))[0]?.questions).toEqual([]);
  await expect(service.answerDurableChildQuestion(ref, qid, "Not escalated")).rejects.toThrow("not open for the user");
  await service.dispose(); service = open();
  await service.resumeDurableSessions([ref]);
  await sleep(400); expect(parentQuestions).toHaveLength(1);
  await service.prompt(ref, `REPLY ${qid}`);
  await vi.waitFor(async () => { expect(await service.decisions(ref), JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toHaveLength(1); });
  await service.dispose(); service = open(); await service.resumeDurableSessions([ref]);
  await vi.waitFor(async () => { expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain("Finished: The parent answered: TASK-VALUE"); });
  expect(parentQuestions).toHaveLength(1); expect(await service.decisions(ref)).toHaveLength(1);
  await expect(service.answerDurableChildQuestion(ref, qid, "Again")).rejects.toThrow("not open");
});
it.each(["live", "finished"])("overturns exactly once to the %s child's correction target, including after reopen", async (state) => {
  mode = state === "live" ? "live" : "answer";
  const ref = await start();
  await vi.waitFor(async () => { expect(await service.decisions(ref)).toHaveLength(1); });
  const child = required((await service.durableChildren(ref))[0]);
  if (state === "live") await vi.waitFor(() => { expect(parentQuestions).toHaveLength(2); });
  else await vi.waitFor(async () => { expect((await service.durableChildren(ref))[0]?.busy).toBe(false); });
  const decision = required((await service.decisions(ref))[0]);
  const app = Fastify(); registerDecisionRoutes(app, service, "/api");
  try {
    const url = `/api/sessions/${ref.id}/decisions/${encodeURIComponent(decision.id)}/overturn`;
    expect((await app.inject({method: "POST", url, payload: {cwd: root, note: " "}})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: `/api/sessions/${ref.id}/decisions/unknown/overturn`, payload: {cwd: root, note: "Use NEW"}})).statusCode).toBe(404);
    const payload = {cwd: root, note: "Use NEW"};
    expect((await app.inject({method: "POST", url, payload})).json()).toMatchObject({state: {kind: "overturned", note: "Use NEW"}});
    expect((await app.inject({method: "POST", url, payload})).statusCode).toBe(409);
    expect((await app.inject({url: `/api/sessions/${ref.id}/decisions?cwd=${encodeURIComponent(root)}`})).json()).toHaveLength(1);
  } finally { await app.close(); }
  if (state === "live") {
    const qid = questionId(parentQuestions[1]);
    mode = "answer"; await service.prompt(ref, `REPLY ${qid}`);
  }
  const correction = `[decision ${decision.id} overturned by the user]`;
  const target = async () => state === "live" ? (await service.durableChildMessages(ref, child.conversationId)).messages : (await service.messages(ref, {limit: 200})).messages;
  const occurrences = async () => (await target()).flatMap((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user" && "content" in message && text(message.content).startsWith(correction) ? [text(message.content)] : []);
  await vi.waitFor(async () => { expect(await occurrences()).toHaveLength(1); });
  expect((await occurrences())[0]).toContain("Correction: Use NEW. Redo the affected work.");
  await service.dispose(); service = open(); await service.resumeDurableSessions([ref]);
  expect(await occurrences()).toHaveLength(1);
  await expect(service.overturnDecision(ref, decision.id, "Again")).rejects.toThrow("already overturned");
});
it("records only escalation guesses, keeps workflow association, and lists newest first", async () => {
  await mkdir(join(root, ".pi/prompts"), {recursive: true});
  await writeFile(join(root, ".pi/prompts/check.md"), "---\nworkflow: {version: 1}\n---\nWait.");
  const ref = {id: (await service.start(root)).id, cwd: root};
  const run = await service.runWorkflow(ref, "check", {}, "run-check");
  await vi.waitFor(async () => { expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain("Workflow run "); expect((await service.status(ref)).isStreaming).toBe(false); });
  const ended = () => hub.sessionEvents.filter(({event}) => event.type === "agent.end").length;
  let before = ended();
  await service.prompt(ref, "RECORD false");
  await vi.waitFor(() => { expect(ended()).toBeGreaterThan(before); });
  expect(await service.decisions(ref)).toEqual([]);
  before = ended();
  await service.prompt(ref, "RECORD true");
  await vi.waitFor(async () => { expect((await service.status(ref)).flaggedDecisions).toBe(1); });
  await vi.waitFor(() => { expect(ended()).toBeGreaterThan(before); });
  await service.prompt(ref, "Start");
  await vi.waitFor(async () => { expect(await service.decisions(ref)).toHaveLength(2); });
  const decisions = await service.decisions(ref);
  expect(decisions.map((decision) => decision.kind)).toEqual(["child-answer", "guess"]);
  expect(decisions.every((decision) => decision.runId === run.id)).toBe(true);
});
it("returns an empty decision list without Durable hosting and validates strict request shapes", async () => {
  await service.dispose(); service = open(false);
  const ref = {id: (await service.start(root)).id, cwd: root};
  const app = Fastify(); registerDecisionRoutes(app, service, "/api");
  try {
    const base = `/api/sessions/${ref.id}/decisions`;
    const response = await app.inject({url: `${base}?cwd=${encodeURIComponent(root)}`});
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual([]);
    expect((await app.inject({url: base})).statusCode).toBe(400);
    expect((await app.inject({url: `${base}?cwd=${encodeURIComponent(root)}&extra=1`})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: `${base}/unknown/overturn`, payload: {cwd: root, note: "Correct it", extra: true}})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: `${base}/unknown/overturn`, payload: {cwd: root, note: "Correct it"}})).statusCode).toBe(404);
  } finally { await app.close(); }
});
