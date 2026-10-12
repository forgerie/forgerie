import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC with one `echo`
 * tool. It writes its pid so the test can check the session stops it.
 */
const PROBE_SERVER = `
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.argv[2], String(process.pid));
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === "initialize") send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "probe", version: "1.0.0" } } });
  else if (method === "tools/list") send({ id, result: { tools: [{ name: "echo", description: "Echo the given text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  else if (method === "tools/call") send({ id, result: { content: [{ type: "text", text: "probe echo: " + params.arguments.text }] } });
  else if (method === "ping") send({ id, result: {} });
  else send({ id, error: { code: -32601, message: "Method not found" } });
});
`;

type AgentStep = AssistantMessage | ((context: TranscriptContext) => AssistantMessage);

/** A hosted session whose profile `mcp.json` registers the probe server. */
async function hostedSessionWithProbeServer(steps: (seenTools: string[][]) => AgentStep[]) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-mcp-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const home = join(root, "home");
  await Promise.all([agentDir, cwd, home].map((path) => mkdir(path, { recursive: true })));
  const serverPath = join(root, "probe-server.mjs");
  const pidPath = join(root, "probe.pid");
  await writeFile(serverPath, PROBE_SERVER);
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [serverPath, pidPath] } } }));
  vi.stubEnv("HOME", home);
  // Sessiond pins this to the active profile; Pi's MCP extension reads it.
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

  const seenTools: string[][] = [];
  const agentSteps = steps(seenTools);
  const respond = (context: TranscriptContext): AssistantMessage => {
    if (getCurrentSystemPrompt(context.messages).includes("retrieval label")) return fauxAssistantMessage("MCP probe");
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
    codemodeEnabled: true,
    heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const session = await service.start(cwd, { initialModelSpec: "faux/faux-1" });
  return { service, ref: { id: session.id, cwd }, events, seenTools, pidPath };
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("Forgerie MCP", () => {
  it("connects profile MCP servers and reaches their tools from codemode scripts", async () => {
    const harness = await hostedSessionWithProbeServer((seenTools) => [
      (context) => {
        seenTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
        return fauxAssistantMessage([fauxText("Calling the probe."), fauxToolCall("codemode", {
          code: "const [hit] = await searchTools('echo text', { namespace: 'probe' });\nreturn await tools[hit.name]({ text: 'hello' });",
        }, { id: "call_script" })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("Done."),
    ]);

    await harness.service.prompt(harness.ref, "go");
    await vi.waitFor(() => {
      expect(harness.events.sessionEvents.some(({ event }) => event.type === "agent.end")).toBe(true);
    }, { timeout: 15_000 });

    // Codemode exposure keeps MCP tools out of the model's declarations.
    expect(harness.seenTools[0]).toContain("codemode");
    expect(harness.seenTools[0]?.some((name) => name.startsWith("mcp__"))).toBe(false);
    const end = harness.events.sessionEvents.map(({ event }) => event).find((event) => event.type === "tool.end");
    expect(end).toMatchObject({ toolName: "codemode", isError: false });
    expect(end?.type === "tool.end" ? end.text : "").toContain("probe echo: hello");

    const pid = Number(await readFile(harness.pidPath, "utf8"));
    expect(isRunning(pid)).toBe(true);
    await harness.service.dispose();
    await vi.waitFor(() => { expect(isRunning(pid)).toBe(false); }, { timeout: 5_000 });
  }, 30_000);
});
