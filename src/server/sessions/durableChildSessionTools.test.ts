import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager, createAgentSessionServices, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getCurrentTools, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";
import { DurableSdkTools } from "./durableSdkTools.js";
import { createDurableChildHost } from "./durableChildHost.js";

const roots: string[] = [];
const sessions: DurableAgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(named: string[], definitions: Pick<ToolDefinition, "name" | "exposure">[], deny: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-child-session-tools-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(join(agentDir, "agents", "probe.md"), `---\nname: probe\ndescription: Tool probe\ntools: ${named.join(", ")}\n---\nCHILD-PROBE\n`);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 10000 });
  models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const model = models.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Missing configured model");
  const calls: { id: string; name: string; version: number }[] = [];
  const hooks: string[] = [];
  let version = 1;
  let blocked = false;
  let registerTool: ((definition: Pick<ToolDefinition, "name" | "exposure">) => void) | undefined;
  const services = await createAgentSessionServices({ cwd: root, agentDir, modelRuntime: models,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [{ name: "child-probe", factory: (pi) => {
        const loadedVersion = version;
        registerTool = (definition) => { pi.registerTool({ ...definition, label: definition.name, description: "Probe session tool", defaultActive: false,
          parameters: Type.Object({ query: Type.String({ minLength: 1 }) }), execute: (id) => {
            calls.push({ id, name: definition.name, version: loadedVersion });
            return Promise.resolve({ content: [{ type: "text" as const, text: `shared version ${String(loadedVersion)}` }], details: {} });
          } }); };
        for (const definition of definitions) registerTool(definition);
        pi.on("tool_call", (event) => {
          if (event.toolName !== "child_agent") hooks.push(`call:${event.toolCallId}`);
          if (blocked) return { block: true, reason: "Child call blocked by extension" };
          return undefined;
        });
        pi.on("tool_result", (event) => {
          hooks.push(`result:${event.toolCallId}`);
          return { content: [{ type: "text", text: "hooked result" }] };
        });
      } }] } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false } });
  const session = await DurableAgentSession.open({ services, sessionManager: SessionManager.create(root, join(root, "sessions")), initialModel: model,
    childAgents: createDurableChildHost({ childToolsDeny: deny }) });
  sessions.push(session);
  session.subscribe(() => undefined);
  await session.bindExtensions({});
  const offered: string[][] = [];
  const instructions: string[] = [];
  let query = "valid";
  let forceNamedCall = false;
  provider.setResponses(Array.from({ length: 100 }, () => (context) => {
    const prompt = getCurrentSystemPrompt(context.messages);
    if (prompt.includes("CHILD-PROBE")) {
      offered.push(getCurrentTools(context.messages).map((tool) => tool.name));
      instructions.push(prompt);
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") return fauxAssistantMessage("CHILD-DONE");
      return named[0] !== undefined && (forceNamedCall || getCurrentTools(context.messages).some((tool) => tool.name === named[0]))
        ? fauxAssistantMessage([fauxToolCall(named[0], { query }, { id: "same-id" })], { stopReason: "toolUse" })
        : fauxAssistantMessage("CHILD-DONE");
    }
    const last = context.messages.at(-1);
    const text = JSON.stringify(last);
    if (text.includes("SPAWN")) return fauxAssistantMessage([fauxToolCall("child_agent", { action: "spawn", name: `probe${String(offered.length)}`, agent: "probe", message: "Run your named tool once", isolation: "shared", allowMissingTools: true }, { id: "same-id" })], { stopReason: "toolUse" });
    return fauxAssistantMessage("parent done");
  }));
  async function spawn() {
    const count = (await session.durableChildren()).length;
    await session.prompt("SPAWN");
    await vi.waitFor(async () => {
      expect((await session.durableChildren()).length).toBe(count + 1);
      const children = await session.durableChildren();
      const child = children.at(-1);
      if (child === undefined) throw new Error("Missing child");
      expect(JSON.stringify(await session.durableChildMessages(child.conversationId))).toContain("CHILD-DONE");
      expect(session.workingDurableChildren).toBe(0);
      expect(session.isStreaming).toBe(false);
    }, { timeout: 10000 });
  }
  return { session, calls, hooks, offered, instructions, spawn, sharedToolNames: () => {
    const sdk = new DurableSdkTools({ cwd: root, settings: services.settingsManager, runner: session.extensionRunner, customTools: [],
      beforeCall: () => Promise.resolve(), emit: () => undefined });
    return sdk.childTools(() => sdk, deny).map((tool) => tool.name);
  }, registerTool: (name: string) => {
    if (registerTool === undefined) throw new Error("Extension did not load");
    registerTool({ name });
  }, setVersion: (value: number) => { version = value; }, setBlocked: () => { blocked = true; }, setQuery: (value: string) => { query = value; }, forceNamedCall: () => { forceNamedCall = true; } };
}

it("executes a named registered (inactive) session tool through validation and extension hooks, with a child call id", async () => {
  const probe = await fixture(["web_search"], [{ name: "web_search" }, { name: "fetch_content" }]);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human", "web_search"]);
  expect(probe.calls).toHaveLength(1);
  expect(probe.calls[0]?.id).not.toBe("same-id");
  expect(probe.hooks).toEqual([`call:${probe.calls[0]?.id ?? ""}`, `result:${probe.calls[0]?.id ?? ""}`]);
  const child = (await probe.session.durableChildren())[0];
  expect(JSON.stringify(await probe.session.durableChildMessages(child?.conversationId ?? 0))).toContain("hooked result");
  probe.setQuery("");
  await probe.spawn();
  expect(probe.calls).toHaveLength(1);
});

it("offers tools registered after the parent session opens, without a reload", async () => {
  const probe = await fixture(["web_search"], []);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human"]);
  probe.registerTool("web_search");
  await probe.spawn();
  expect(probe.offered).toContainEqual(["ask_human", "web_search"]);
  expect(probe.calls).toHaveLength(1);
});

it("lets extension tool_call hooks block a child call before execution", async () => {
  const probe = await fixture(["web_search"], [{ name: "web_search" }]);
  probe.setBlocked();
  await probe.spawn();
  expect(probe.calls).toEqual([]);
  expect(probe.hooks).toHaveLength(1);
  const child = (await probe.session.durableChildren())[0];
  expect(JSON.stringify(await probe.session.durableChildMessages(child?.conversationId ?? 0))).toContain("Child call blocked by extension");
});

it.each(["deferred", "codemode"] as const)("offers named %s session tools directly to a child", async (exposure) => {
  const probe = await fixture(["web_search"], [{ name: "web_search", exposure }]);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human", "web_search"]);
  expect(probe.calls).toHaveLength(1);
});

it.each(["child_agent", "ask_user", "end_turn", "spawn_session", "handoff_session", "workflow_finish", "workflow_stop", "propose_workflow", "saved_workflows", "file_issue", "propose_future", "subagent", "bg_wait", "web_enable"])("never offers parent-only %s even if registered and named", async (name) => {
  const probe = await fixture([name], [{ name }]);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human"]);
  expect(probe.calls).toEqual([]);
  expect(probe.instructions[0]).toContain(`Not available here: ${name}`);
  expect(probe.instructions[0]).toContain("Do not file issues. Suggest issues in your report; the parent files them.");
  expect(JSON.stringify(probe.session.messages)).toContain(`Not available to it here: tools ${name}`);
});

it("refuses a child's attempted file_issue call, even when the parent registers a direct implementation", async () => {
  const probe = await fixture(["file_issue"], [{ name: "file_issue" }]);
  probe.forceNamedCall();
  await probe.spawn();
  expect(probe.calls).toEqual([]);
  const child = (await probe.session.durableChildren())[0];
  if (child === undefined) throw new Error("Missing child");
  const transcript = JSON.stringify(await probe.session.durableChildMessages(child.conversationId));
  expect(transcript).toContain('"toolName":"file_issue"');
  expect(transcript).toContain('"isError":true');
});

it.each(["grep", "find", "ls"])("excludes the parent's %s tool from shared declarations and translates it to child-native bash", async (name) => {
  const probe = await fixture([name], [{ name }]);
  expect(probe.session.extensionRunner.getToolDefinition(name)?.name).toBe(name);
  expect(probe.sharedToolNames()).not.toContain(name);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human", "bash"]);
  expect(probe.calls).toEqual([]);
});

it.each(["model-only", "hidden"] as const)("never offers a tool with %s exposure", async (exposure) => {
  const probe = await fixture(["private_tool"], [{ name: "private_tool", exposure }]);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human"]);
  expect(probe.calls).toEqual([]);
});

it.each(["denied", "missing"])("reports a %s tool to both child and parent", async (kind) => {
  const probe = await fixture(["fetch_content"], kind === "missing" ? [] : [{ name: "fetch_content" }], kind === "denied" ? ["fetch_content"] : []);
  await probe.spawn();
  expect(probe.offered[0]).toEqual(["ask_human"]);
  expect(probe.calls).toEqual([]);
  expect(probe.instructions[0]).toContain("Not available here: fetch_content");
  expect(JSON.stringify(probe.session.messages)).toContain("Not available to it here: tools fetch_content");
});

it("resolves an existing child's tool from the replacement session registry after reload", async () => {
  const probe = await fixture(["web_search"], [{ name: "web_search" }]);
  await probe.spawn();
  probe.setVersion(2);
  await probe.session.reload();
  const child = (await probe.session.durableChildren())[0];
  if (child === undefined) throw new Error("Missing child");
  await probe.session.messageDurableChild(child.conversationId, "Run again");
  await vi.waitFor(() => { expect(probe.calls).toHaveLength(2); }, { timeout: 10000 });
  expect(probe.calls.map((call) => call.version)).toEqual([1, 2]);
  expect(new Set(probe.calls.map((call) => call.id)).size).toBe(2);
});
