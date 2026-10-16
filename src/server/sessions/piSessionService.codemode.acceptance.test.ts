import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime } from "./piSessionService.testSupport.js";
import { projectBrowserMessageResponse, projectBrowserSessionEvent } from "../browserMessageProjection.js";

const roots: string[] = [];
const services: PiSessionService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type AgentStep = AssistantMessage | ((context: TranscriptContext) => AssistantMessage);

/**
 * A hosted session whose model is Pi's scripted provider. Agent turns take the
 * given steps in order; Forgerie's own session-title request, which shares
 * the session model, gets a fixed label instead of consuming a step.
 */
async function hostedSession(codemodeEnabled: boolean, steps: (seenTools: string[][]) => AgentStep[]) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-codemode-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const home = join(root, "home");
  await Promise.all([agentDir, cwd, home].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(cwd, "hello.txt"), "hello from a file\n");
  vi.stubEnv("HOME", home);

  const seenTools: string[][] = [];
  const agentSteps = steps(seenTools);
  const respond = (context: TranscriptContext): AssistantMessage => {
    if (getCurrentSystemPrompt(context.messages).includes("retrieval label")) return fauxAssistantMessage("Codemode probe");
    const step = agentSteps.shift();
    if (step === undefined) throw new Error("The scripted model ran out of steps");
    return typeof step === "function" ? step(context) : step;
  };
  const faux = createFauxCore({ provider: "faux", api: "faux" });
  faux.setResponses(Array.from({ length: 12 }, () => respond));
  const modelRuntime = await createTestModelRuntime();
  modelRuntime.registerProvider("faux", {
    api: "faux",
    apiKey: "faux-key",
    baseUrl: "http://localhost:0",
    streamSimple: faux.streamSimple,
    models: [{ id: "faux-1", name: "Faux", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000 }],
  });

  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir,
    modelRuntime,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
    askUserEnabled: true,
    codemodeEnabled,
    heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const session = await service.start(cwd, { initialModelSpec: "faux/faux-1" });
  return { service, ref: { id: session.id, cwd }, events, seenTools, agentDir, modelRuntime };
}

/** A step that records the tools the model was offered, then answers. */
function recordTools(seenTools: string[][], answer: AssistantMessage): AgentStep {
  return (context) => {
    seenTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
    return answer;
  };
}

function scriptCall(code: string): AssistantMessage {
  return fauxAssistantMessage([fauxText("Running a script."), fauxToolCall("codemode", { code }, { id: "call_script" })], { stopReason: "toolUse" });
}

async function runPrompt(harness: Awaited<ReturnType<typeof hostedSession>>): Promise<SessionUiEvent[]> {
  await harness.service.prompt(harness.ref, "go");
  await vi.waitFor(() => {
    expect(harness.events.sessionEvents.some(({ event }) => event.type === "agent.end")).toBe(true);
  }, { timeout: 10_000 });
  return harness.events.sessionEvents.map(({ event }) => event);
}

function toolEvents(events: readonly SessionUiEvent[]) {
  return events.filter((event): event is Extract<SessionUiEvent, { type: "tool.start" | "tool.update" | "tool.end" }> =>
    event.type === "tool.start" || event.type === "tool.update" || event.type === "tool.end");
}

function scriptResultText(events: readonly SessionUiEvent[]): string {
  const end = toolEvents(events).find((event) => event.type === "tool.end");
  return end?.type === "tool.end" ? end.text : "";
}

describe("Hosted response declarations", () => {
  it.each(["reply", "nothing"] as const)("ends a real hosted run with %s, without another model response", async (awaiting) => {
    const harness = await hostedSession(true, () => [fauxAssistantMessage([
      fauxText("The result is ready."), fauxToolCall("end_turn", { awaiting }, { id: "end-1" }),
    ], { stopReason: "toolUse" })]);
    await runPrompt(harness);
    expect((await harness.service.status(harness.ref)).response).toEqual(awaiting === "reply" ? { kind: "needs-response", reason: "reply" } : { kind: "none" });
    await harness.service.stop(harness.ref);
    expect((await harness.service.status(harness.ref)).response).toEqual(awaiting === "reply" ? { kind: "needs-response", reason: "reply" } : { kind: "none" });
  });

  it("shows a hidden-only end_turn reply once, including read-only reopen and runtime replay", async () => {
    const reply = "The result is ready. Which fix do you want?";
    const harness = await hostedSession(true, (seenTools) => [recordTools(seenTools, fauxAssistantMessage([
      { type: "thinking", thinking: "PRIVATE REASONING" },
      fauxToolCall("end_turn", { awaiting: "reply", reply }, { id: "reply-end" }),
    ], { stopReason: "toolUse" }))]);
    await runPrompt(harness);
    const answers = async (service: PiSessionService) => projectBrowserMessageResponse(await service.messages(harness.ref)).messages
      .filter(message => typeof message === "object" && message !== null && Reflect.get(message, "role") === "assistant" && JSON.stringify(Reflect.get(message, "content")).includes('"type":"text"'));
    expect(await answers(harness.service)).toEqual([expect.objectContaining({ content: [{ type: "text", text: reply }] })]);
    expect(harness.seenTools).toHaveLength(1);
    expect((await harness.service.status(harness.ref)).response).toEqual({ kind: "needs-response", reason: "reply" });
    await harness.service.dispose();
    const reopened = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: harness.agentDir, modelRuntime: harness.modelRuntime,
      sessionManager: createPiSessionManagerGateway({ agentDir: harness.agentDir, env: {}, sessionDirEnvKeys: [] }),
      askUserEnabled: true, heartbeatIntervalMs: 60_000,
    });
    services.push(reopened);
    expect(await answers(reopened)).toEqual([expect.objectContaining({ content: [{ type: "text", text: reply }] })]);
    await reopened.resumeDurableSessions([harness.ref]);
    expect(await answers(reopened)).toEqual([expect.objectContaining({ content: [{ type: "text", text: reply }] })]);
    expect(harness.seenTools).toHaveLength(1);
    expect((await reopened.status(harness.ref)).response).toEqual({ kind: "needs-response", reason: "reply" });
  });

  it("keeps visible assistant text instead of duplicating an end_turn reply", async () => {
    const harness = await hostedSession(true, () => [fauxAssistantMessage([
      fauxText("Original answer."), fauxToolCall("end_turn", { awaiting: "nothing", reply: "Do not duplicate." }),
    ], { stopReason: "toolUse" })]);
    await runPrompt(harness);
    const visible = JSON.stringify(projectBrowserMessageResponse(await harness.service.messages(harness.ref)).messages);
    expect(visible).toContain("Original answer.");
    expect(visible).not.toContain("Do not duplicate.");
  });

  it("shows the text-only reply after a silent declaration and marks the session as needing a response", async () => {
    const harness = await hostedSession(true, () => [
      fauxAssistantMessage([fauxToolCall("end_turn", { awaiting: "reply" }, { id: "silent" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Both problems have one cause. Which fix do you want?"),
    ]);
    await runPrompt(harness);
    expect((await harness.service.status(harness.ref)).response).toEqual({ kind: "needs-response", reason: "undeclared" });
    const visible = projectBrowserMessageResponse(await harness.service.messages(harness.ref)).messages;
    expect(visible.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Both problems have one cause. Which fix do you want?" }] });
  });

  it("stops repeated silent declarations, exposes the errors, and keeps the response request after restart", async () => {
    const harness = await hostedSession(true, (seenTools) => Array.from({ length: 3 }, (_, index) => recordTools(seenTools,
      fauxAssistantMessage([fauxToolCall("end_turn", { awaiting: "nothing" }, { id: `silent-${String(index)}` })], { stopReason: "toolUse" }))));
    const events = await runPrompt(harness);
    expect(harness.seenTools).toHaveLength(2);
    expect((await harness.service.status(harness.ref)).response).toEqual({ kind: "needs-response", reason: "undeclared" });
    const visible = projectBrowserMessageResponse(await harness.service.messages(harness.ref));
    expect(visible.messages.filter(message => typeof message === "object" && message !== null && Reflect.get(message, "role") === "toolResult"))
      .toEqual([expect.objectContaining({ toolName: "end_turn", isError: true }), expect.objectContaining({ toolName: "end_turn", isError: true })]);
    expect(events.map(projectBrowserSessionEvent).filter(event => event.type === "tool.end" && event.isError)).toHaveLength(2);
    expect(JSON.stringify(visible.messages)).toContain("run stopped");

    await harness.service.dispose();
    const reopened = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: harness.agentDir, modelRuntime: harness.modelRuntime,
      sessionManager: createPiSessionManagerGateway({ agentDir: harness.agentDir, env: {}, sessionDirEnvKeys: [] }),
      askUserEnabled: true, heartbeatIntervalMs: 60_000,
    });
    services.push(reopened);
    expect((await reopened.machineListing()).sessions.find(item => item.id === harness.ref.id)?.response).toEqual({ kind: "needs-response", reason: "undeclared" });
    expect(JSON.stringify(projectBrowserMessageResponse(await reopened.messages(harness.ref)).messages)).toContain("run stopped");
  });

  it("rebuilds an unanswered browser form after constructing a new daemon service", async () => {
    const harness = await hostedSession(true, () => [fauxAssistantMessage([fauxToolCall("ask_user", { questions: [{ id: "q", question: "Which database?" }] }, { id: "ask-1" })], { stopReason: "toolUse" })]);
    await runPrompt(harness);
    const before = await harness.service.status(harness.ref);
    expect(before.pendingAsk?.questions[0]?.question).toBe("Which database?");
    await harness.service.dispose();
    const reopened = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: harness.agentDir, modelRuntime: harness.modelRuntime,
      sessionManager: createPiSessionManagerGateway({ agentDir: harness.agentDir, env: {}, sessionDirEnvKeys: [] }),
      askUserEnabled: true, heartbeatIntervalMs: 60_000,
    });
    services.push(reopened);
    const catalog = await reopened.machineListing();
    expect(catalog.sessions.find((item) => item.id === harness.ref.id)?.response).toEqual({ kind: "needs-response", reason: "questions" });
    expect((await reopened.status(harness.ref)).pendingAsk).toEqual(before.pendingAsk);
  });

  it("classifies a hosted run with no declaration as needing a response", async () => {
    const harness = await hostedSession(true, () => [fauxAssistantMessage("Done.")]);
    await runPrompt(harness);
    expect((await harness.service.status(harness.ref)).response).toEqual({ kind: "needs-response", reason: "undeclared" });
  });
});

describe("Forgerie codemode", () => {
  it("offers codemode to the model and runs a script's calls as one transcript step", async () => {
    const harness = await hostedSession(true, (seenTools) => [
      recordTools(seenTools, scriptCall([
        "// List the project and read one file",
        "const [ls, file] = await Promise.all([tools.bash({ command: 'ls -1' }), tools.read({ path: 'hello.txt' })]);",
        "text(ls.output);",
        "return file;",
      ].join("\n"))),
      fauxAssistantMessage("Done."),
    ]);

    const events = await runPrompt(harness);
    expect(harness.seenTools[0]).toContain("codemode");

    // The script's own calls are progress of the one step, never steps of their own.
    const tools = toolEvents(events);
    expect(new Set(tools.map((event) => event.toolCallId))).toEqual(new Set(["call_script"]));
    expect(tools.find((event) => event.type === "tool.start")).toMatchObject({ toolName: "codemode", summary: "List the project and read one file" });
    const end = tools.find((event) => event.type === "tool.end");
    expect(end).toMatchObject({ isError: false, details: { calls: [{ name: "bash", status: "ok" }, { name: "read", status: "ok" }] } });
    const progress = tools.filter((event) => event.type === "tool.update").at(-1);
    expect(progress?.details).toMatchObject({ calls: [{ name: "bash", status: "ok" }, { name: "read", status: "ok" }] });
    const eventTypes = tools.map((event) => event.type);
    expect(eventTypes.lastIndexOf("tool.update")).toBeLessThan(eventTypes.indexOf("tool.end"));
    expect(scriptResultText(events)).toContain("hello from a file");

    // A reload draws the same step from history.
    const history = await harness.service.messages(harness.ref);
    const result = history.messages.find((message) => typeof message === "object" && message !== null && Reflect.get(message, "role") === "toolResult");
    expect(result).toMatchObject({ toolName: "codemode", toolCallId: "call_script", details: { calls: [{ name: "bash" }, { name: "read" }] } });
  });

  it("keeps run-ending and session-making tools out of scripts", async () => {
    const harness = await hostedSession(true, (seenTools) => [
      recordTools(seenTools, scriptCall(
        "return JSON.stringify({ ask: 'ask_user' in tools, bash: 'bash' in tools });",
      )),
      fauxAssistantMessage("Done."),
    ]);

    const events = await runPrompt(harness);
    // The model itself still declares ask_user; only scripts cannot reach it.
    expect(harness.seenTools[0]).toEqual(expect.arrayContaining(["ask_user", "codemode"]));
    expect(harness.seenTools[0]).not.toContain("subagent");
    expect(scriptResultText(events)).toContain("{\"ask\":false,\"bash\":true}");
  });

  it("leaves codemode inactive when the setting is off", async () => {
    const harness = await hostedSession(false, (seenTools) => [recordTools(seenTools, fauxAssistantMessage("Done."))]);
    await runPrompt(harness);
    expect(harness.seenTools[0]).not.toContain("codemode");
    expect(harness.seenTools[0]).toContain("bash");
  });
});
