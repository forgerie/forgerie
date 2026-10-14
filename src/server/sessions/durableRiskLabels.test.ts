import { createDurableChildHost } from "./durableChildHost.js";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager, createAgentSessionServices, createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { DurableAgentSession } from "./durableAgentSession.js";
import { createDecisionClient, type DecisionAnswers, type DecisionRequest } from "../decisions/decisionClient.js";
import { readDecisionHintsSettings } from "../decisions/decisionHintsSettings.js";
import { assertDecisionHintOffEquivalence } from "../decisions/decisionHintsOffEquivalence.testSupport.js";
import type { DecisionHints } from "../decisions/decisionHints.js";
import { RISK_LABEL_ENTRY_KIND } from "../../shared/riskLabels.js";

const roots: string[] = []; const sessions: DurableAgentSession[] = []; const servers: Server[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => {resolve();})); }
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});
const settings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
const opinion: DecisionAnswers = {model: "actual-risk-model", answers: {
  deletes_data: {type: "noul", noul: 0.1}, outside_worktree: {type: "noul", noul: 0.2}, acts_as_user: {type: "noul", noul: 0.3},
  risk: {type: "score", score: 0.4, probabilities: {"0": 0.6, "1": 0.4, "2": 0}, confidence: 0.6},
}};
async function fixture(hints?: DecisionHints) {
  const root = await mkdtemp(join(tmpdir(), "risk-labels-")); roots.push(root); await mkdir(join(root, "agent"));
  const models = await ModelRuntime.create({authPath: join(root, "auth.json"), modelsPath: join(root, "models.json")});
  const provider = fauxProvider({tokensPerSecond: 100000}); models.registerNativeProvider(provider.provider);
  const model = models.getModel("faux", "faux-1"); if (model === undefined) throw new Error("Missing model");
  const createServices = () => createAgentSessionServices({cwd: root, agentDir: join(root, "agent"), modelRuntime: models,
    resourceLoaderOptions: {noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [{name: "codemode", factory: createCodemodeExtension()}]}});
  const services = await createServices();
  services.settingsManager.applyOverrides({defaultTools: ["bash", "+codemode"], compaction: {enabled: false}});
  const manager = SessionManager.create(root, join(root, "sessions"));
  const session = await DurableAgentSession.open({services, sessionManager: manager, initialModel: model, childAgents: createDurableChildHost({homeAgentsDir: join(root, "home-agents"), builtinAgentsDirs: []}), ...(hints === undefined ? {} : {decisionHints: hints})}); sessions.push(session);
  const events: unknown[] = []; const errors: string[] = [];
  session.subscribe(event => events.push(event)); await session.bindExtensions({onError: error => {errors.push(error.error);}});
  const run = async (nested = false, command = "printf RAN > effect") => {
    provider.setResponses([fauxAssistantMessage([fauxToolCall(nested ? "codemode" : "bash", nested ? {code: `return await tools.bash(${JSON.stringify({command})});`} : {command}, {id: "bash-call"})], {stopReason: "toolUse"}), fauxAssistantMessage("Finished")]);
    await session.prompt("Run command");
  };
  const runChild = async () => {
    provider.setResponses(Array.from({length: 40}, () => request => {
      const last = request.messages.at(-1);
      if (last?.role === "user" && last.content === "CHILD") return fauxAssistantMessage([fauxToolCall("bash", {command: "printf CHILD > child-effect"}, {id: "child-bash"})], {stopReason: "toolUse"});
      if (last?.role === "user" && last.content === "SPAWN") return fauxAssistantMessage([fauxToolCall("child_agent", {action: "spawn", name: "helper", message: "CHILD", isolation: "shared"})], {stopReason: "toolUse"});
      return fauxAssistantMessage("Finished");
    }));
    await session.prompt("SPAWN");
    await vi.waitFor(async () => {expect(await readFile(join(root, "child-effect"), "utf8")).toBe("CHILD"); expect((await session.durableChildren())[0]?.busy).toBe(false);});
    const child = (await session.durableChildren())[0]; if (child === undefined) throw new Error("Missing child");
    return child;
  };
  return {root, session, services, manager, model, events, errors, run, createServices, runChild};
}

it("bash has off-equivalence and executes before a hanging gateway times out", async () => {
  await assertDecisionHintOffEquivalence(async ({client, settings: live}) => {
    const f = await fixture(client === undefined ? undefined : {client, readSettings: () => live, status: () => ({keyPresent: false})});
    await f.run();
    return {observe: async () => ({effect: await readFile(join(f.root, "effect"), "utf8"),
      gates: await f.session.gatedActions(), errors: f.errors,
      outputs: f.session.messages.filter(message => message.role === "toolResult").map(message => message.content),
      annotations: f.session.messages.filter(message => message.role === "custom" && message.customType === RISK_LABEL_ENTRY_KIND),
    })};
  }, {timeoutMs: 3000});
});

it.each([false, true])("delivers a late bash label live and through persisted history (nested=%s)", async nested => {
  let answer: ((value: DecisionAnswers) => void) | undefined; let asks = 0; let request: DecisionRequest | undefined;
  const f = await fixture({client: {ask: value => {asks++; request = value; return new Promise(resolve => {answer = resolve;});}}, readSettings: () => settings, status: () => ({keyPresent: false})});
  await f.run(nested);
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe("RAN"); expect(asks).toBe(1);
  expect(request?.state).toMatchObject({cwd: f.root, tool: "bash", arguments: JSON.stringify({command: "printf RAN > effect"})});
  expect(f.session.messages.some(message => message.role === "custom" && message.customType === RISK_LABEL_ENTRY_KIND)).toBe(false);
  answer?.(opinion);
  await vi.waitFor(() => {expect(f.errors).toEqual([]); expect(JSON.stringify(f.events)).toContain(RISK_LABEL_ENTRY_KIND);});
  await f.session.refreshDurableReads();
  const entry = (await f.session.journal.conversation.context(context)).entries.find(value => value.kind === RISK_LABEL_ENTRY_KIND);
  expect(entry?.data).toMatchObject({target: "tool", id: nested ? "bash-call/1" : "bash-call", label: {model: "actual-risk-model", risk: "low", risk_score: 0.4}});
  expect(entry?.model).toBeUndefined(); // The annotation is not extra model input.
  expect(f.errors).toEqual([]);
  const file = f.manager.getSessionFile(); if (file === undefined) throw new Error("Missing transcript");
  await f.session.close();
  const services = await f.createServices();
  services.settingsManager.applyOverrides({defaultTools: ["bash", "+codemode"], compaction: {enabled: false}});
  const reopened = await DurableAgentSession.open({services, sessionManager: SessionManager.open(file), initialModel: f.model}); sessions.push(reopened);
  expect(JSON.stringify(reopened.messages)).toContain("actual-risk-model");
});

it("redacts the real HTTP gateway payload while a real bash command keeps its original arguments", async () => {
  const requests: unknown[] = []; const server = createServer((request, response) => {
    expect(request.url).toBe("/v1/systemone"); let body = ""; request.setEncoding("utf8"); request.on("data", (chunk: string) => {body += chunk;});
    request.on("end", () => {requests.push(JSON.parse(body)); response.end(JSON.stringify(opinion));});
  }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("Missing gateway address");
  const live = {...settings, baseUrl: `http://127.0.0.1:${String(address.port)}`};
  const client = createDecisionClient({readConfig: () => live});
  const f = await fixture({client, readSettings: () => live, status: () => ({keyPresent: false})});
  const command = `KEY='must-stay-local' bash -c 'printf %s "$KEY" > effect'`;
  await f.run(false, command);
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe("must-stay-local");
  await vi.waitFor(() => { expect(JSON.stringify(f.events)).toContain("actual-risk-model"); });
  expect(requests).toHaveLength(1); expect(f.errors).toEqual([]);
  expect(requests[0]).toMatchObject({state: {arguments: JSON.stringify({command: `KEY='[redacted]' bash -c 'printf %s "$KEY" > effect'`})}});
  expect(JSON.stringify(requests)).not.toContain("must-stay-local");
  expect(JSON.stringify(f.session.messages)).toContain("must-stay-local");
});

it("native child bash has off-equivalence and does not wait for the hanging gateway", async () => {
  await assertDecisionHintOffEquivalence(async ({client, settings: live}) => {
    const f = await fixture(client === undefined ? undefined : {client, readSettings: () => live, status: () => ({keyPresent: false})});
    const child = await f.runChild();
    return {observe: async () => ({effect: await readFile(join(f.root, "child-effect"), "utf8"),
      gates: await f.session.gatedActions(), errors: f.errors,
      outputs: (await f.session.durableChildMessages(child.conversationId)).messages.filter(message => message.role === "toolResult").map(message => message.content),
      annotations: (await f.session.durableChildMessages(child.conversationId)).messages.filter(message => message.role === "custom"),
    })};
  }, {timeoutMs: 3000});
});

it("records a native child bash label by the child call id after that call ends", async () => {
  let answer: ((value: DecisionAnswers) => void) | undefined; let asks = 0; let request: DecisionRequest | undefined;
  const f = await fixture({client: {ask: value => {asks++; request = value; return new Promise(resolve => {answer = resolve;});}}, readSettings: () => settings, status: () => ({keyPresent: false})});
  const child = await f.runChild();
  expect(asks).toBe(1); expect(request?.state).toMatchObject({tool: "bash", cwd: f.root});
  answer?.(opinion);
  await vi.waitFor(async () => {expect(JSON.stringify(await f.session.durableChildMessages(child.conversationId))).toContain("actual-risk-model");});
  const transcript = await f.session.durableChildMessages(child.conversationId);
  expect(transcript.messages.find(message => message.role === "custom")).toMatchObject({customType: RISK_LABEL_ENTRY_KIND,
    details: {target: "tool", id: "child-bash", label: {model: "actual-risk-model"}}});
  expect(f.errors).toEqual([]); expect(await readFile(join(f.root, "child-effect"), "utf8")).toBe("CHILD");
  expect(JSON.stringify(f.session.messages)).not.toContain("actual-risk-model");
});
