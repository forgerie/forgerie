import { RiskLabelEntrySchema } from "../../shared/riskLabels.js";
import { Check } from "typebox/value";
import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
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
  const childState = {command: "printf CHILD > child-effect"};
  const runChild = async (marker = "CHILD") => {
    childState.command = `printf ${marker} > child-effect`;
    provider.setResponses(Array.from({length: 40}, () => request => {
      const last = request.messages.at(-1);
      if (last?.role === "user" && last.content === "CHILD") return fauxAssistantMessage([fauxToolCall("bash", {command: childState.command}, {id: "child-bash"})], {stopReason: "toolUse"});
      if (last?.role === "user" && last.content === "SPAWN") return fauxAssistantMessage([fauxToolCall("child_agent", {action: "spawn", name: "helper", message: "CHILD", isolation: "shared"})], {stopReason: "toolUse"});
      return fauxAssistantMessage("Finished");
    }));
    await session.prompt("SPAWN");
    await vi.waitFor(async () => {expect(await readFile(join(root, "child-effect"), "utf8")).toBe(marker); expect((await session.durableChildren())[0]?.busy).toBe(false);});
    const child = (await session.durableChildren())[0]; if (child === undefined) throw new Error("Missing child");
    return child;
  };
  return {root, session, services, manager, model, events, errors, run, createServices, runChild, childState};
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

it.each([false, true])("delivers a late bash label live and through volatile history (nested=%s)", async nested => {
  let answer: ((value: DecisionAnswers) => void) | undefined; let asks = 0; let request: DecisionRequest | undefined;
  const f = await fixture({client: {ask: value => {asks++; request = value; return new Promise(resolve => {answer = resolve;});}}, readSettings: () => settings, status: () => ({keyPresent: false})});
  await f.run(nested);
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe("RAN"); expect(asks).toBe(1);
  expect(request?.state).toMatchObject({cwd: f.root, tool: "bash", arguments: JSON.stringify({command: "printf RAN > effect"})});
  expect(f.session.messages.some(message => message.role === "custom" && message.customType === RISK_LABEL_ENTRY_KIND)).toBe(false);
  answer?.(opinion);
  await vi.waitFor(() => {expect(f.errors).toEqual([]); expect(JSON.stringify(f.events)).toContain(RISK_LABEL_ENTRY_KIND);});
  await f.session.refreshDurableReads();
  const entry = f.session.messages.flatMap(message => message.decisionAnnotations ?? []).find(value => value.target === "tool");
  expect(entry).toMatchObject({target: "tool", id: nested ? "bash-call/1" : "bash-call", label: {model: "actual-risk-model", risk: "low", risk_score: 0.4}});
  expect((await f.session.journal.conversation.context(context)).entries.some(value => value.kind === RISK_LABEL_ENTRY_KIND)).toBe(false);
  expect(JSON.stringify(await f.session.parentReadModel.messages(context))).toContain("actual-risk-model");
  expect(f.errors).toEqual([]);
  const file = f.manager.getSessionFile(); if (file === undefined) throw new Error("Missing transcript");
  await f.session.close();
  const services = await f.createServices();
  services.settingsManager.applyOverrides({defaultTools: ["bash", "+codemode"], compaction: {enabled: false}});
  const reopened = await DurableAgentSession.open({services, sessionManager: SessionManager.open(file), initialModel: f.model}); sessions.push(reopened);
  expect(JSON.stringify(reopened.messages)).not.toContain("actual-risk-model");
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
  expect(transcript.messages.flatMap(message => message.decisionAnnotations ?? [])[0]).toMatchObject({target: "tool", id: "child-bash", label: {model: "actual-risk-model"}});
  expect(f.errors).toEqual([]); expect(await readFile(join(f.root, "child-effect"), "utf8")).toBe("CHILD");
  expect(JSON.stringify(f.session.messages)).not.toContain("actual-risk-model");
});

it.each(["sdk", "nested", "child"] as const)("a rejected %s bash-label write cannot poison later declarations, execution intent or results", async source => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const f = await fixture({ client: { ask: () => new Promise(resolve => { answer = resolve; }) }, readSettings: () => settings, status: () => ({ keyPresent: false }) });
  if (source === "child") await f.runChild(); else await f.run(source === "nested");
  vi.spyOn(decisionAnnotations(f.session.journal.harness), "write").mockRejectedValueOnce(new Error("bash label write rejected"));
  answer?.(opinion);
  await vi.waitFor(() => { expect(f.errors).toHaveLength(1); });
  expect(f.errors[0]).toContain("bash label write rejected");
  await f.session.parentState.declareResponse("reply", context);
  expect(await f.session.parentState.response(context)).toEqual({ kind: "needs-response", reason: "reply" });
  await f.run(false, "printf LATER > effect");
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe("LATER");
  expect(f.session.messages.some(message => message.role === "toolResult" && message.isError)).toBe(false);
  expect((await f.session.journal.conversation.context(context)).entries.some(entry => entry.kind === RISK_LABEL_ENTRY_KIND)).toBe(false);
});

it.each([false, true])("repeated SDK call ids keep both invocation labels, even when the older answer arrives last (nested=%s)", async nested => {
  const answers: ((value: DecisionAnswers) => void)[] = [];
  const f = await fixture({client: {ask: () => new Promise(resolve => {answers.push(resolve);})}, readSettings: () => settings, status: () => ({keyPresent: false})});
  await f.run(nested, "printf FIRST"); await f.run(nested, "printf SECOND");
  expect(answers).toHaveLength(2);
  answers[1]?.({...opinion, model: "SECOND-model"});
  await vi.waitFor(() => {expect(JSON.stringify(f.session.messages)).toContain("SECOND-model");});
  answers[0]?.({...opinion, model: "FIRST-model"});
  await vi.waitFor(() => {expect(JSON.stringify(f.session.messages)).toContain("FIRST-model");});
  const sources = f.session.messages.filter(message => message.role === "assistant" && message.toolInvocations?.["bash-call"] !== undefined);
  expect(sources).toHaveLength(2);
  expect(sources.map(message => message.decisionAnnotations?.[0]?.label.model)).toEqual(["FIRST-model", "SECOND-model"]);
  expect(new Set(sources.map(message => message.toolInvocations?.["bash-call"])).size).toBe(2);
  expect(sources.flatMap(message => message.decisionAnnotations ?? []).every(entry => entry.target === "tool" && (nested ? entry.invocationId !== entry.sourceInvocationId : entry.invocationId === entry.sourceInvocationId))).toBe(true);
  const page = await f.session.parentReadModel.history({limit: 100}, context);
  const labels = page.messages.flatMap(message => message.decisionAnnotations ?? []).filter(value => Check(RiskLabelEntrySchema, value));
  expect(labels.map(entry => entry.label.model)).toEqual(["FIRST-model", "SECOND-model"]);
  expect(f.errors).toEqual([]);
});

it("native child repeated ids never reuse a prior label or let a late prior answer label the next turn", async () => {
  const answers: ((value: DecisionAnswers) => void)[] = [];
  const live = {...settings};
  const f = await fixture({client: {ask: () => new Promise(resolve => {answers.push(resolve);})}, readSettings: () => live, status: () => ({keyPresent: false})});
  const child = await f.runChild("FIRST");
  f.childState.command = "printf SECOND > child-effect";
  await f.session.messageDurableChild(child.conversationId, "CHILD");
  await vi.waitFor(async () => {expect(await readFile(join(f.root, "child-effect"), "utf8")).toBe("SECOND"); expect((await f.session.durableChildMessages(child.conversationId)).busy).toBe(false);});
  expect(answers).toHaveLength(2);
  answers[1]?.({...opinion, model: "SECOND-model"}); answers[0]?.({...opinion, model: "FIRST-model"});
  await vi.waitFor(async () => {expect(JSON.stringify(await f.session.durableChildMessages(child.conversationId))).toContain("FIRST-model");});
  const sources = (await f.session.durableChildMessages(child.conversationId)).messages.filter(message => message.role === "assistant" && message.toolInvocations?.["child-bash"] !== undefined);
  expect(sources).toHaveLength(2);
  expect(sources.map(message => message.decisionAnnotations?.[0]?.label.model)).toEqual(["FIRST-model", "SECOND-model"]);
  live.risk_labels = false;
  expect(JSON.stringify(await f.session.durableChildMessages(child.conversationId))).not.toContain("FIRST-model");
  live.risk_labels = true; live.enabled = false;
  expect(JSON.stringify(await f.session.durableChildMessages(child.conversationId))).not.toContain("SECOND-model");
  expect(f.errors).toEqual([]);
});

it.each(["enabled", "risk_labels"] as const)("parent overlays hide existing labels when the live %s switch is off", async key => {
  const live = {...settings};
  const f = await fixture({client: {ask: () => Promise.resolve(opinion)}, readSettings: () => live, status: () => ({keyPresent: false})});
  await f.run();
  await vi.waitFor(() => {expect(JSON.stringify(f.session.messages)).toContain("actual-risk-model");});
  const before = await f.session.parentReadModel.history({limit: 100}, context);
  live[key] = false;
  expect(JSON.stringify(f.session.messages)).not.toContain("actual-risk-model");
  const after = await f.session.parentReadModel.history({limit: 100}, context);
  expect(JSON.stringify(after)).not.toContain("actual-risk-model");
  expect({start: after.start, total: after.total, count: after.messages.length}).toEqual({start: before.start, total: before.total, count: before.messages.length});
});

it("whole-family close clears existing annotations and discards a late gateway answer", async () => {
  const answers: ((value: DecisionAnswers) => void)[] = [];
  const f = await fixture({client: {ask: () => new Promise(resolve => {answers.push(resolve);})}, readSettings: () => settings, status: () => ({keyPresent: false})});
  await f.run(); answers[0]?.(opinion);
  await vi.waitFor(() => {expect(JSON.stringify(f.session.messages)).toContain("actual-risk-model");});
  await f.run(false, "printf SECOND");
  expect(answers).toHaveLength(2);
  const owner = f.session.journal.harness; const scope = String(f.session.journal.conversation.id);
  const store = decisionAnnotations(owner); expect(store.values(scope)).toHaveLength(1);
  await f.session.close(); expect(store.values(scope)).toEqual([]);
  answers[1]?.({...opinion, model: "too-late"});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(store.values(scope)).toEqual([]); expect(decisionAnnotations(owner)).toBe(store); expect(f.errors).toEqual([]);
});
