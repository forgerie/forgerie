import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime } from "./piSessionService.testSupport.js";

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
  return { service, ref: { id: session.id, cwd }, events, seenTools };
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
    const progress = tools.filter((event) => event.type === "tool.update").at(-1);
    expect(progress?.details).toMatchObject({ calls: [{ name: "bash" }, { name: "read" }] });
    const end = tools.find((event) => event.type === "tool.end");
    expect(end).toMatchObject({ isError: false, details: { calls: [{ name: "bash", status: "ok" }, { name: "read", status: "ok" }] } });
    expect(scriptResultText(events)).toContain("hello from a file");

    // A reload draws the same step from history.
    const history = await harness.service.messages(harness.ref);
    const result = history.messages.find((message) => typeof message === "object" && message !== null && Reflect.get(message, "role") === "toolResult");
    expect(result).toMatchObject({ toolName: "codemode", toolCallId: "call_script", details: { calls: [{ name: "bash" }, { name: "read" }] } });
  });

  it("keeps run-ending, session-making, and delegating tools out of scripts", async () => {
    const harness = await hostedSession(true, (seenTools) => [
      recordTools(seenTools, scriptCall(
        "return JSON.stringify({ ask: 'ask_user' in tools, subagent: 'subagent' in tools, bash: 'bash' in tools });",
      )),
      fauxAssistantMessage("Done."),
    ]);

    const events = await runPrompt(harness);
    // The model itself still declares ask_user; only scripts cannot reach it.
    expect(harness.seenTools[0]).toEqual(expect.arrayContaining(["ask_user", "subagent", "codemode"]));
    expect(scriptResultText(events)).toContain("{\"ask\":false,\"subagent\":false,\"bash\":true}");
  });

  it("leaves codemode inactive when the setting is off", async () => {
    const harness = await hostedSession(false, (seenTools) => [recordTools(seenTools, fauxAssistantMessage("Done."))]);
    await runPrompt(harness);
    expect(harness.seenTools[0]).not.toContain("codemode");
    expect(harness.seenTools[0]).toContain("bash");
  });
});
