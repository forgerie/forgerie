import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ModelRuntime, SessionManager, createAgentSessionServices, defineTool } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import { hostedCodemodeExtension } from "./codemode.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { createDurableChildHost } from "./durableChildHost.js";

const roots: string[] = []; const sessions: DurableAgentSession[] = [];
afterEach(async () => { for (const session of sessions) await session.close(); for (const root of roots) await rm(root, {recursive: true, force: true}); roots.length = 0; sessions.length = 0; });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-nested-gates-")); roots.push(root);
  const cwd = join(root, "repo"); const agentDir = join(root, "agent"); await mkdir(cwd); await mkdir(join(agentDir, "agents"), {recursive: true});
  await writeFile(join(agentDir, "agents", "nested.md"), "---\nname: nested\ntools: nested_forward\n---\nNESTED-CHILD\n");
  const git = (...args: string[]) => promisify(execFile)("git", ["-C", cwd, ...args]);
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(cwd, "base"), "base"); await git("add", "base"); await git("commit", "-m", "Base");
  const remote = join(root, "remote.git"); await promisify(execFile)("git", ["init", "--bare", remote]); await git("remote", "add", "origin", remote); await git("push", "origin", "main");
  const hook = join(cwd, ".git", "hooks", "pre-push"); await writeFile(hook, `#!/bin/sh\necho run >> '${join(root, "pushes")}'\n`); await chmod(hook, 0o700);
  const calls: string[] = [];
  const ebay = defineTool({name: "host_ebay_seller_message_reply", label: "Reply", description: "Reply", exposure: "deferred", outputSchema: Type.Object({reply: Type.String()}), parameters: Type.Object({text: Type.String()}),
    execute: async (_id, args) => { calls.push(args.text); await writeFile(join(root, "ebay-effect"), args.text); return {content: [{type: "text", text: "Sent exact message " + args.text}], details: {}, structuredContent: {reply: args.text}}; },
  });
  const forward = defineTool({name: "nested_forward", label: "Forward", description: "Forward", defaultActive: false, parameters: Type.Object({}),
    execute: async (_id, _args, _signal, _onUpdate, ctx) => (await ctx.executeTool(ebay.name, {text: "child message"})).result,
  });
  const models = await ModelRuntime.create({authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json")});
  const provider = fauxProvider({tokensPerSecond: 100000}); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  provider.setResponses(Array.from({length: 100}, () => fauxAssistantMessage("Result received")));
  const codemode = hostedCodemodeExtension(); if (typeof codemode === "function") throw new Error("Expected the named hosted codemode extension");
  const createServices = () => createAgentSessionServices({cwd, agentDir, modelRuntime: models, resourceLoaderOptions: {noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [{...codemode, builtin: false}]}});
  const services = await createServices();
  services.settingsManager.applyOverrides({defaultTools: ["bash", "read", "write", "codemode"], compaction: {enabled: false}});
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  const model = models.getModel("faux", "faux-1"); if (model === undefined) throw new Error("Missing model");
  const options = {services, sessionManager: manager, customTools: [ebay, forward], childAgents: createDurableChildHost(), initialModel: model};
  const session = await DurableAgentSession.open(options); sessions.push(session);
  await session.bindExtensions({});
  return {root, cwd, provider, session, calls, options, createServices};
}
async function script(f: Awaited<ReturnType<typeof fixture>>, code: string) {
  f.provider.setResponses([fauxAssistantMessage([fauxToolCall("codemode", {code}, {id: "script"})], {stopReason: "toolUse"}), fauxAssistantMessage("Script finished")]);
  await f.session.prompt("Run script");
  const result = [...f.session.messages].reverse().find(message => message.role === "toolResult" && message.toolName === "codemode");
  if (result?.role !== "toolResult") throw new Error("Missing codemode result");
  return result;
}
it.each([
  {call: 'tools.bash({command: "git push --force origin main"})', category: "force-push", tool: "bash"},
  {call: 'tools.host_ebay_seller_message_reply({text: "exact message"})', category: "messages", tool: "host_ebay_seller_message_reply"},
])("gates codemode $tool without failing the script, then approves the exact call once", async test => {
  const f = await fixture();
  const result = await script(f, `const waiting = await ${test.call}; text(waiting); await tools.write({path: "independent", content: "CONTINUED"}); return "SCRIPT-CONTINUED";`);
  expect(result.isError, JSON.stringify(result)).toBe(false); expect(JSON.stringify(result)).toContain("Blocked until the user approves"); expect(JSON.stringify(result)).toContain("SCRIPT-CONTINUED");
  expect(await readFile(join(f.cwd, "independent"), "utf8")).toBe("CONTINUED");
  const gates = await f.session.gatedActions(); expect(gates).toHaveLength(1); const gate = gates[0]; if (gate === undefined) throw new Error("Missing gate");
  expect(gate).toMatchObject({by: "parent", tool: test.tool, category: test.category, state: {kind: "waiting"}});
  expect(f.session.waitingOnUser).toBe(1); expect(f.calls).toEqual([]); expect(await readFile(join(f.root, "pushes"), "utf8").catch(() => "")).toBe("");
  expect((await f.session.journal.conversation.context(context)).entries.filter(entry => entry.kind === "forgerie.gated-action")).toHaveLength(1);
  // The nested registry must not expose a deferred tool as a direct model declaration.
  expect((await f.session.journal.conversation.agent(context)).tools.some(tool => tool.name === "host_ebay_seller_message_reply")).toBe(false);
  await f.session.decideGatedAction(gate.id, "approved");
  await vi.waitFor(async () => { expect((await f.session.gatedActions())[0]?.state.kind).toBe("ran"); });
  await vi.waitFor(() => { expect(JSON.stringify(f.session.messages)).toContain(`Gate ${gate.id} ran:`); });
  if (test.tool === "bash") expect(await readFile(join(f.root, "pushes"), "utf8")).toBe("run\n");
  else {
    expect(f.calls).toEqual(["exact message"]);
    const state = (await f.session.gatedActions())[0]?.state;
    if (state?.kind !== "ran") throw new Error("Missing approved result");
    expect(state.result).toMatchObject({structuredContent: {reply: "exact message"}});
  }
  await expect(f.session.decideGatedAction(gate.id, "approved")).rejects.toThrow("not waiting");
});
it("still executes a non-gated nested bash call", async () => {
  const f = await fixture(); const result = await script(f, 'const result = await tools.bash({command: "printf allowed > allowed"}); return "NON-GATED-RAN";');
  expect(result.isError, JSON.stringify(result)).toBe(false); expect(await readFile(join(f.cwd, "allowed"), "utf8")).toBe("allowed"); expect(await f.session.gatedActions()).toEqual([]);
});
it("attributes a shared tool's nested call to the child, not its SDK owner", async () => {
  const f = await fixture();
  f.provider.setResponses(Array.from({length: 40}, () => request => {
    const last = request.messages.at(-1);
    if (last?.role === "user" && last.content === "CHILD") return fauxAssistantMessage([fauxToolCall("nested_forward", {})], {stopReason: "toolUse"});
    if (last?.role === "user" && last.content === "SPAWN") return fauxAssistantMessage([fauxToolCall("child_agent", {action: "spawn", name: "helper", agent: "nested", message: "CHILD", isolation: "shared"})], {stopReason: "toolUse"});
    return fauxAssistantMessage("Finished");
  }));
  await f.session.prompt("SPAWN");
  await vi.waitFor(async () => { expect(await f.session.gatedActions()).toMatchObject([{by: "child helper", tool: "host_ebay_seller_message_reply", args: {text: "child message"}}]); });
  const gate = (await f.session.gatedActions())[0]; if (gate === undefined) throw new Error("Missing gate");
  expect(gate.conversationId).not.toBe(Number(f.session.journal.conversation.id)); expect(f.calls).toEqual([]);
  await f.session.decideGatedAction(gate.id, "approved");
  await vi.waitFor(() => { expect(f.calls).toEqual(["child message"]); });
});
it("retains a deferred nested gate across restart and executes only that call after approval", async () => {
  const f = await fixture(); await script(f, 'return await tools.host_ebay_seller_message_reply({text: "after restart"});');
  const gate = (await f.session.gatedActions())[0]; if (gate === undefined) throw new Error("Missing gate");
  const file = f.session.sessionFile; if (file === undefined) throw new Error("Missing session file");
  await f.session.close();
  const services = await f.createServices(); services.settingsManager.applyOverrides({defaultTools: ["bash", "read", "write", "codemode"], compaction: {enabled: false}});
  f.session = await DurableAgentSession.open({...f.options, services, sessionManager: SessionManager.open(file)}); sessions.push(f.session); await f.session.bindExtensions({});
  expect(await f.session.gatedActions()).toHaveLength(1); expect(f.calls).toEqual([]);
  await f.session.decideGatedAction(gate.id, "approved"); await vi.waitFor(async () => { expect((await f.session.gatedActions())[0]?.state.kind).toBe("ran"); });
  expect(f.calls).toEqual(["after restart"]);
});
it("refuses a nested gate without running it or repeating the script", async () => {
  const f = await fixture(); await script(f, 'text(await tools.host_ebay_seller_message_reply({text: "do not send"})); return "SCRIPT-END";');
  const gate = (await f.session.gatedActions())[0]; if (gate === undefined) throw new Error("Missing gate");
  await f.session.decideGatedAction(gate.id, "refused");
  await vi.waitFor(() => { expect(JSON.stringify(f.session.messages)).toContain(`The user refused gate ${gate.id}:`); });
  expect(f.calls).toEqual([]); expect(await f.session.gatedActions()).toHaveLength(1);
});
it("keeps parallel nested gates and repeated model call IDs independent", async () => {
  const f = await fixture();
  await script(f, 'const calls = await Promise.all([tools.host_ebay_seller_message_reply({text: "one"}), tools.host_ebay_seller_message_reply({text: "two"})]); return calls;');
  await script(f, 'return await tools.host_ebay_seller_message_reply({text: "three"});');
  const gates = await f.session.gatedActions(); expect(gates).toHaveLength(3); expect(new Set(gates.map(gate => gate.id)).size).toBe(3);
  const one = gates.find(gate => gate.args["text"] === "one"); if (one === undefined) throw new Error("Missing first gate");
  await f.session.decideGatedAction(one.id, "approved"); await vi.waitFor(() => { expect(f.calls).toEqual(["one"]); });
  expect((await f.session.gatedActions()).filter(gate => gate.state.kind === "waiting")).toHaveLength(2);
});
