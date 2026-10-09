// SPIKE (spike/durable-child): Durable-native child agents through Forgerie's real session service and Durable
// factory. Each `it` is one pass criterion from .pi-web/handoffs/61ee9462-2fb9-4065-98e2-1af80aca22e8.md.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { defineTool } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CHILD_QUESTION_KIND, durableChildExtensions } from "./durableChildAgents.js";

type Attempt = { conv: number; step: number; phase: "start" | "end"; service: number };
const attempts: Attempt[] = [];
let serviceGeneration = 0;

const work = defineTool({
  name: "work",
  description: "Do one step of work.",
  parameters: Type.Object({ step: Type.Number(), of: Type.Number() }),
  replay: "safe",
  executionMode: "sequential",
  execute: async (args, api) => {
    const generation = serviceGeneration;
    attempts.push({ conv: Number(api.conversationId), step: args.step, phase: "start", service: generation });
    await sleep(250);
    attempts.push({ conv: Number(api.conversationId), step: args.step, phase: "end", service: generation });
    return { content: [{ type: "text" as const, text: `work step ${String(args.step)}/${String(args.of)} done` }] };
  },
});

const text = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? "").join("") : "";

/** One scripted model for the parent, every child, and title generation. It answers by the last message. */
const route: FauxResponseFactory = (context) => {
  const last = context.messages.at(-1);
  const said = text(last?.content);
  const call = (name: string, args: Record<string, string | number>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
  const answer = (value: string): AssistantMessage => fauxAssistantMessage([fauxText(value)]);
  if (last?.role === "toolResult") {
    if (said.startsWith("Started") || said.startsWith("Sent")) return answer(`OK. ${said}`);
    const step = /work step (\d+)\/(\d+) done/.exec(said);
    if (step !== null) return Number(step[1]) < Number(step[2]) ? call("work", { step: Number(step[1]) + 1, of: Number(step[2]) }) : answer(`All ${step[2] ?? ""} steps done.`);
    if (said.startsWith("The user answered:")) return answer(`Thanks. ${said}`);
    return answer(`Tool said: ${said}`);
  }
  if (said.startsWith("[subagent")) return answer("Noted.");
  if (said.startsWith("STEER")) return answer("Steered: finishing early.");
  const spawn = /^Start a subagent named (\w+): ([\s\S]*)$/.exec(said);
  if (spawn !== null) return call("subagent", { action: "spawn", name: spawn[1] ?? "", message: spawn[2] ?? "" });
  const steps = /run work (\d+) times/.exec(said);
  if (steps !== null) return call("work", { step: 1, of: Number(steps[1]) });
  if (said.includes("ASK")) return call("ask_human", { question: "Which colour should the button be?" });
  return answer("Session title");
};

let directory = "";
let agentDir = "";
let models: ModelRuntime;
let provider: ReturnType<typeof fauxProvider>;
let hub: CapturingSessionEventHub;
let service: PiSessionService;

async function openService(): Promise<PiSessionService> {
  serviceGeneration += 1;
  hub = new CapturingSessionEventHub();
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
  return new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(),
    heartbeatIntervalMs: 60_000, durableChildAgents: durableChildExtensions({ childTools: [work] }) });
}

async function until<T>(what: string, check: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(40);
  }
}

type Message = { role?: string; content?: unknown; customType?: string };
const transcript = async (ref: { id: string; cwd: string }) => (await service.messages(ref, { limit: 500 })).messages as Message[];
const reports = async (ref: { id: string; cwd: string }, name: string) => (await transcript(ref)).filter((m) => m.role === "user" && text(m.content).startsWith(`[subagent ${name} `));
const parentAnswers = async (ref: { id: string; cwd: string }) => (await transcript(ref)).filter((m) => m.role === "assistant").length;
const child = async (ref: { id: string; cwd: string }, name: string) => until(`child ${name}`, async () => (await service.durableChildren(ref)).find((c) => c.name === name));
const ended = (conv: number) => attempts.filter((a) => a.conv === conv && a.phase === "end");

beforeEach(async () => {
  attempts.length = 0;
  directory = await mkdtemp(join(tmpdir(), "forgerie-durable-children-"));
  agentDir = join(directory, "agent");
  models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  provider = fauxProvider({ tokensPerSecond: 400 });
  models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 400 }, () => route));
  service = await openService();
});
afterEach(async () => {
  await service.dispose();
  await rm(directory, { recursive: true, force: true });
});

describe("SPIKE: Durable-native child agents in a Forgerie session", () => {
  it("C1+C2: a child is listed and readable through the service, and a steer from the user reaches it", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a subagent named builder: run work 4 times");
    const builder = await child(ref, "builder");
    expect(builder.busy).toBe(true);
    await until("builder step 1", async () => ended(builder.conversationId).length >= 1);
    await service.messageDurableChild(ref, builder.conversationId, "STEER: finish now");
    await until("builder report", async () => (await reports(ref, "builder")).length === 1);
    const childMessages = await service.durableChildMessages(ref, builder.conversationId);
    expect(childMessages.filter((m) => m.role === "user").map((m) => text(m.content))).toEqual(["run work 4 times", "STEER: finish now"]);
    expect(ended(builder.conversationId).length).toBeLessThan(4);
    expect(text((await reports(ref, "builder"))[0]?.content)).toContain("Steered: finishing early.");
    // The subagent tool result carries the child's conversation id, so a UI can link the call to the child view.
    expect(JSON.stringify(await transcript(ref))).toContain(`"conversationId":${String(builder.conversationId)}`);
  }, 30_000);

  it("C3: stopping a child ends its work, reports nothing, and gives the parent no turn", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a subagent named stopper: run work 10 times");
    const stopper = await child(ref, "stopper");
    await until("stopper step 1", async () => ended(stopper.conversationId).length >= 1);
    await until("parent idle", async () => !(await service.status(ref)).isStreaming);
    const answersBefore = await parentAnswers(ref);
    await service.stopDurableChild(ref, stopper.conversationId);
    await sleep(800);
    expect(ended(stopper.conversationId).length).toBeLessThan(10);
    expect((await service.durableChildren(ref)).find((c) => c.name === "stopper")?.busy).toBe(false);
    expect(await reports(ref, "stopper")).toHaveLength(0);
    expect(await parentAnswers(ref)).toBe(answersBefore);
    // Esc in the parent does not reach a background child.
    await service.prompt(ref, "Start a subagent named survivor: run work 3 times");
    const survivor = await child(ref, "survivor");
    await until("survivor step 1", async () => ended(survivor.conversationId).length >= 1);
    await service.abort(ref);
    await until("survivor report", async () => (await reports(ref, "survivor")).length === 1);
    expect(ended(survivor.conversationId)).toHaveLength(3);
  }, 30_000);

  it("C5: a child question shows in the parent transcript live and on reload, with no parent turn, and the answer reaches the child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a subagent named asker: ASK the user");
    const asker = await child(ref, "asker");
    const question = await until("question in transcript", async () => (await transcript(ref)).find((m) => m.customType === CHILD_QUESTION_KIND));
    await until("parent idle", async () => !(await service.status(ref)).isStreaming);
    const answersAtQuestion = await parentAnswers(ref);
    await sleep(600);
    expect(text(question.content)).toBe("asker asks: Which colour should the button be?");
    expect(await parentAnswers(ref)).toBe(answersAtQuestion);
    expect((await service.status(ref)).isStreaming).toBe(false);
    expect((await service.durableChildren(ref)).find((c) => c.name === "asker")?.pendingQuestions).toBe(1);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.end" && JSON.stringify(event.message).includes(CHILD_QUESTION_KIND))).toBe(true);
    const questionId = String((question as { details?: { questionId?: string } }).details?.questionId);
    await service.answerDurableChildQuestion(ref, questionId, "Teal");
    expect(await parentAnswers(ref)).toBe(answersAtQuestion);
    await until("asker report", async () => (await reports(ref, "asker")).length === 1);
    expect(text((await reports(ref, "asker"))[0]?.content)).toContain("Teal");
    expect((await service.durableChildMessages(ref, asker.conversationId)).some((m) => text(m.content).includes("The user answered: Teal"))).toBe(true);
    await expect(service.answerDurableChildQuestion(ref, questionId, "Again")).rejects.toThrow("is not open");
  }, 30_000);

  it("C4a: a daemon restart mid-tool pauses the child until the parent opens, then it finishes once", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a subagent named runner: run work 5 times");
    const runner = await child(ref, "runner");
    await until("runner step 2 started", async () => attempts.filter((a) => a.conv === runner.conversationId && a.phase === "start").length >= 2);
    await service.dispose();
    const stepsAtStop = ended(runner.conversationId).length;
    service = await openService();
    await sleep(1000);
    const stepsWhileClosed = ended(runner.conversationId).length;
    // Reading the transcript does not open the Durable session. Only opening the parent resumes its children.
    expect(await reports(ref, "runner")).toHaveLength(0);
    await service.durableChildren(ref);
    await until("runner report after reopen", async () => (await reports(ref, "runner")).length === 1, 20_000);
    await sleep(300);
    expect(stepsWhileClosed).toBe(stepsAtStop);
    expect([...new Set(ended(runner.conversationId).map((a) => a.step))].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await reports(ref, "runner")).toHaveLength(1);
    expect(await service.durableChildren(ref)).toHaveLength(1);
  }, 40_000);

  it("C4b: a daemon restart while a child waits on a question keeps one question, and an answer after it reaches the child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a subagent named waiter: ASK the user");
    const question = await until("question", async () => (await transcript(ref)).find((m) => m.customType === CHILD_QUESTION_KIND));
    const questionId = String((question as { details?: { questionId?: string } }).details?.questionId);
    await service.dispose();
    service = await openService();
    await service.durableChildren(ref);
    await sleep(800);
    expect((await transcript(ref)).filter((m) => m.customType === CHILD_QUESTION_KIND)).toHaveLength(1);
    await service.answerDurableChildQuestion(ref, questionId, "Amber");
    await until("waiter report", async () => (await reports(ref, "waiter")).length === 1, 20_000);
    expect(text((await reports(ref, "waiter"))[0]?.content)).toContain("Amber");
    expect((await transcript(ref)).filter((m) => m.customType === CHILD_QUESTION_KIND)).toHaveLength(1);
  }, 40_000);
});
