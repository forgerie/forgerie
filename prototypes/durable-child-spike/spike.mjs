#!/usr/bin/env -S /run/current-system/sw/bin/nix shell nixpkgs#nodejs_24 -c node
// PROTOTYPE. Throwaway. Durable-native child agents for Forgerie, phase 1 (headless).
//
// Question: can one child agent run as a Durable-owned conversation, and does it
//   1. exist as an ordinary conversation a UI can open and watch,
//   2. take a steer from the host while it works,
//   3. stop on request without stopping the parent (and survive the parent's Esc),
//   4. survive a harness restart (mid-tool and mid-question) without duplicates,
//   5. ask the user a question that lands in the parent transcript without a parent turn?
//
// Usage: ./spike.mjs [faux|real]   (default faux: scripted model, deterministic)
// Modules resolve from the main checkout's node_modules (this worktree sits inside it).
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Type, createModels, createProvider } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  AssistantEntry, Harness, LiveDoc, configure, createRegistry, defineDoc, defineExtension, defineTask, defineTool, watchEvents,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const MODE = process.argv[2] ?? "faux";
const dir = mkdtempSync(join(tmpdir(), "PROTOTYPE-durable-child-spike-"));
const attemptsLog = join(dir, "attempts.log");
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)} ms]`, ...a);
const results = [];
const check = (id, name, pass, evidence) => {
  results.push({ id, name, pass, evidence });
  log(`${pass ? "PASS" : "FAIL"} ${id} ${name} :: ${JSON.stringify(evidence)}`);
};

// ─── Product code under test ────────────────────────────────────────────────

const textOf = (message) => (message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");

/** Parent-scoped registry: subagent name -> conversation, plus reporters by spawning call. */
const Subagents = defineDoc({
  kind: "spike.subagents", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});
/** Parent-scoped questions from children. The host answers by committing here. No model turn involved. */
const Questions = defineDoc({
  kind: "spike.questions", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ items: {} }),
});

const Anchor = defineTask({
  name: "spike.subagent-anchor", version: 1, initial: () => ({ phase: "done" }),
  phases: { done: (_a, rt, ctx) => rt.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx) },
  abort: (_a, rt, ctx) => rt.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

const Reporter = defineTask({
  name: "spike.subagent-reporter", version: 1, initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, rt, ctx) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await rt.conversation(conversationId, ctx);
      const submission = await child.submit({ type: "input", content: message, whenBusy: followUp ? "followUp" : "steer", requestId: `subagent:${reporter.id}` }, ctx);
      const settled = await submission.wait(ctx);
      await rt.commit(async (tx) => {
        const next = (report) => ({ status: "running", checkpoint: { phase: "report", report } });
        if (settled.status === "unanswered") return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}]`);
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Subagents, rt.conversationId)).agents[name];
        if (agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0];
        return next(`[subagent ${name} answered, no reply needed] ${textOf(answer)}`);
      }, ctx);
    },
    report: async (reporter, rt, ctx) => {
      const report = reporter.state.checkpoint.report;
      if (report !== undefined) {
        const main = await rt.conversation(rt.conversationId, ctx);
        await main.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `subagent-report:${reporter.id}` }, ctx);
      }
      await rt.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    },
  },
  abort: (_r, rt, ctx) => rt.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

// Child-only tools.
const workTool = defineTool({
  name: "work",
  description: "Do one step of work. Takes about a second. Call with step and of (total steps).",
  parameters: Type.Object({ step: Type.Number(), of: Type.Number() }),
  replay: "safe",
  // A real model batches all steps into one round; sequential keeps a stop or steer meaningful between steps.
  executionMode: "sequential",
  execute: async (args, api) => {
    appendFileSync(attemptsLog, `${JSON.stringify({ tool: "work", taskId: api.taskId, conv: api.conversationId, step: args.step, phase: "start", pid: process.pid })}\n`);
    await sleep(800);
    appendFileSync(attemptsLog, `${JSON.stringify({ tool: "work", taskId: api.taskId, conv: api.conversationId, step: args.step, phase: "end", pid: process.pid })}\n`);
    return { content: [{ type: "text", text: `work step ${args.step}/${args.of} done` }] };
  },
});

/** The child's way to reach the user. Posts a write entry into the parent and waits for the host's answer. */
const askUserTool = defineTool({
  name: "ask_user",
  description: "Ask the human user a question and wait for the answer.",
  parameters: Type.Object({ question: Type.String() }),
  // Rerunning only re-reads: the question id is the call's task id, so a rerun finds the same question.
  replay: "safe",
  execute: async (args, api, ctx) => {
    const parentId = await findParent(api, ctx);
    const questionId = `q:${api.taskId}`;
    const created = await api.commit(async (tx) => {
      const doc = await tx.doc(Questions, parentId);
      if (doc.items[questionId] !== undefined) return false;
      doc.items[questionId] = { child: api.conversationId, question: args.question, answer: null, askedAt: Date.now() };
      return true;
    }, ctx);
    const parent = await api.conversation(parentId, ctx);
    await parent.submit({ type: "write", entry: { kind: "spike.child-question", data: { questionId, child: api.conversationId, question: args.question } }, requestId: `question:${questionId}` }, ctx);
    appendFileSync(attemptsLog, `${JSON.stringify({ tool: "ask_user", taskId: api.taskId, questionId, created, pid: process.pid })}\n`);
    for (;;) {
      const doc = await api.snapshot(Questions, parentId, ctx);
      const answer = doc?.items?.[questionId]?.answer;
      if (answer !== null && answer !== undefined) return { content: [{ type: "text", text: `User answered: ${answer}` }] };
      await sleep(150);
    }
  },
});

async function findParent(api, ctx) {
  // The child's conversation is owned by an anchor task of the parent conversation: the owner edge names both.
  const parentId = await api.commit(async (tx) => (await tx.conversation(api.conversationId))?.owner?.conversationId, ctx);
  if (parentId === undefined) throw new Error("ask_user: no parent conversation");
  return parentId;
}

const ChildTools = defineExtension({ name: "spike.child-tools", tools: [workTool, askUserTool] });

const subagentTool = defineTool({
  name: "subagent",
  description: "Manage background subagents. Actions: spawn (name, message), send (name, message). Answers are reported back.",
  parameters: Type.Object({ action: Type.Union([Type.Literal("spawn"), Type.Literal("send")]), name: Type.String(), message: Type.String() }),
  replay: "unsafe",
  execute: async (args, api, ctx) => {
    const { action, name, message } = args;
    const result = await api.commit(async (tx) => {
      const state = await tx.doc(Subagents, api.conversationId);
      const background = { ownership: { kind: "conversation" }, background: true };
      if (action === "spawn") {
        if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
        const anchor = await tx.createTask(Anchor, null, background);
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
        await configure(tx, child.id, { extensions: [ChildTools], instructions: `You are the subagent "${name}".` });
        state.agents[name] = { conversationId: child.id, reported: [] };
      } else if (!Object.hasOwn(state.agents, name)) return `No subagent named ${name}.`;
      const conversationId = state.agents[name].conversationId;
      state.reporters[api.taskId] = await tx.createTask(Reporter, { name, conversationId, message, followUp: false }, background);
      return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
    }, ctx);
    const current = (await api.snapshot(Subagents, api.conversationId, ctx))?.agents[name];
    return { content: [{ type: "text", text: result }], ...(current === undefined ? {} : { details: { name, conversationId: current.conversationId } }) };
  },
});
const SubagentTools = defineExtension({ name: "spike.subagent-tools", tasks: [Anchor, Reporter], tools: [subagentTool] });

// ─── Host: models ───────────────────────────────────────────────────────────

const models = createModels();
let model;
if (MODE === "real") {
  const proxy = JSON.parse(readFileSync("/home/simonwjackson/.local/share/forgerie/agent/cliproxyapi.json", "utf8"));
  const BASE = `${proxy.baseUrl.replace(/\/+$/, "")}/v1`;
  const id = process.env.SPIKE_MODEL ?? "deepseek-v4.1-flash";
  models.setProvider(createProvider({
    id: "cliproxy", name: "CLIProxyAPI", baseUrl: BASE,
    auth: { apiKey: { name: "CLIProxyAPI", resolve: async () => ({ auth: { apiKey: proxy.apiKey } }) } },
    models: [{ id, name: id, api: "openai-completions", provider: "cliproxy", baseUrl: BASE, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    api: openAICompletionsApi(),
  }));
  model = { provider: "cliproxy", modelId: id };
} else {
  const faux = fauxProvider({ tokensPerSecond: 200 });
  models.setProvider(faux.provider);
  model = { provider: "faux", modelId: "faux-1" };
  const call = (name, input) => fauxAssistantMessage([fauxToolCall(name, input)], { stopReason: "toolUse" });
  const answer = (text) => fauxAssistantMessage([fauxText(text)]);
  const route = (request) => {
    const last = request.messages.findLast((m) => m.role !== "system");
    const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    const text = content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
    if (last.role === "toolResult") {
      if (text.startsWith("Started") || text.startsWith("Sent")) return answer(`OK. ${text}`);
      const step = /work step (\d+)\/(\d+) done/.exec(text);
      if (step) {
        const [n, of] = [Number(step[1]), Number(step[2])];
        return n < of ? call("work", { step: n + 1, of }) : answer(`All ${of} steps done.`);
      }
      if (text.startsWith("User answered:")) return answer(`Thanks. ${text}`);
      return answer(`Tool said: ${text}`);
    }
    if (text.includes("[subagent")) return answer("Noted.");
    if (text.startsWith("STEER")) return answer("Steered: finishing early.");
    const spawn = /^Start a subagent named (\w+): (.*)$/s.exec(text);
    if (spawn) return call("subagent", { action: "spawn", name: spawn[1], message: spawn[2] });
    const work = /run work (\d+) times/.exec(text);
    if (work) return call("work", { step: 1, of: Number(work[1]) });
    if (text.includes("ASK")) return call("ask_user", { question: "Which colour should the button be?" });
    return answer(`Echo: ${text}`);
  };
  faux.setResponses(Array.from({ length: 400 }, () => route));
}

// ─── Host: harness lifecycle ────────────────────────────────────────────────

const registry = createRegistry();
registry.install(SubagentTools);
registry.install(ChildTools);
const dbPath = join(dir, "session.sqlite");
let harness;
let root;
const open = async () => {
  harness = await Harness.open(await openNodeSqliteStorage(dbPath), {
    models, registry, settings: { extensions: [SubagentTools], retry: { maxRetries: 2 }, stream: { timeoutMs: 120_000 } },
  }, context);
  root = await harness.root(context, { agent: { model } });
  harness.resume();
};
const restart = async (why) => {
  log(`-- closing harness (${why})`);
  await harness.close(context);
  await open();
  log("-- harness reopened");
};

// ─── Host: observation helpers ──────────────────────────────────────────────

const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timeout waiting for: ${what}`);
    await sleep(50);
  }
};
const entriesOf = async (conversation) => {
  const out = [];
  let cursor;
  do {
    const page = await conversation.entries({ order: "ascending" }, 256, cursor, context);
    out.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return out;
};
const roleCount = async (conversation, role) => (await entriesOf(conversation)).reduce((n, e) => n + (e.model ?? []).filter((m) => m.role === role).length, 0);
const userTexts = async (conversation) => (await entriesOf(conversation)).flatMap((e) => (e.model ?? []).filter((m) => m.role === "user")
  .map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join(""))));
const assistantTexts = async (conversation) => (await entriesOf(conversation)).flatMap((e) => (e.model ?? []).filter((m) => m.role === "assistant").map(textOf)).filter(Boolean);
const busy = async (id) => (await harness.snapshot(LiveDoc, id, context))?.run !== undefined;
const agentOf = async (name) => (await harness.snapshot(Subagents, root.id, context))?.agents?.[name];
const childOf = async (name) => {
  const agent = await until(`subagent ${name}`, () => agentOf(name));
  return harness.conversation(agent.conversationId, context);
};
const workAttempts = () => {
  try { return readFileSync(attemptsLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
const workStepsEnded = (conv) => workAttempts().filter((a) => a.tool === "work" && a.conv === conv && a.phase === "end").length;
const workStepsStarted = (conv) => workAttempts().filter((a) => a.tool === "work" && a.conv === conv && a.phase === "start").length;
const say = async (text) => { await (await root.submit({ type: "input", content: text }, context)).wait(context); };
const reportsFor = async (name) => (await userTexts(root)).filter((t) => t.startsWith(`[subagent ${name} `));
const settleReports = async () => {
  const reporters = (await harness.snapshot(Subagents, root.id, context))?.reporters ?? {};
  for (const id of Object.values(reporters)) await harness.waitForTask(id, context);
  await root.waitForIdle(context);
};
const conversationCount = async () => harness.inspect(context).then((i) => i.conversations?.length ?? i.conversationCount ?? null).catch(() => null);
const allConversations = async () => root.commit(async (tx) => {
  const out = [];
  let cursor;
  do {
    const page = await tx.scanConversations({}, 256, cursor);
    out.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return out;
}, context);

// ─── Scenarios ──────────────────────────────────────────────────────────────

await open();
log(`storage ${dbPath}; model ${model.provider}/${model.modelId}`);

try {
  // C1: spawn a child; it is an ordinary, watchable conversation linked to the parent.
  {
    await say("Start a subagent named builder: TASK-A run work 4 times. Call the work tool once per step, one call per reply, step 1 to 4 with of=4.");
    const child = await childOf("builder");
    const events = [];
    const stream = await watchEvents(harness, child.id, context);
    stream.start(async (batch) => { for (const e of batch) events.push(e.type); });
    const view = await child.viewState(context);
    const record = (await allConversations()).find((c) => c.id === child.id);
    // C2: steer from the host while the child works (the user typing into the opened child).
    await until("builder finished step 1", () => workStepsEnded(child.id) >= 1);
    const parentAssistantsBeforeSteer = await roleCount(root, "assistant");
    await child.submit({ type: "input", content: "STEER: finish now", whenBusy: "steer" }, context);
    await until("builder idle", async () => !(await busy(child.id)));
    await settleReports();
    const childAnswers = await assistantTexts(child);
    const childUsers = await userTexts(child);
    await stream.stop();
    check("C1", "child is an ordinary conversation, owned via the parent's anchor task, watchable by a UI", record?.owner?.conversationId === root.id && view.value?.entries !== undefined, {
      childId: child.id, owner: record?.owner ?? null, viewEntries: view.value?.entries?.length ?? null,
      eventTypes: [...new Set(events)].slice(0, 12),
    });
    view.dispose?.();
    const steered = (MODE === "real" || childAnswers.at(-1) === "Steered: finishing early.") && childUsers.includes("STEER: finish now");
    check("C2", "host steer reaches the running child at its next tool boundary", steered && workStepsEnded(child.id) < 4, {
      workStepsEnded: workStepsEnded(child.id), childUserMessages: childUsers, lastChildAnswer: childAnswers.at(-1),
      parentAssistantsBeforeSteer, reports: await reportsFor("builder"),
    });
  }

  // C3a: host stop on a child does not touch the parent.
  {
    await say("Start a subagent named stopper: TASK-B run work 10 times. Call the work tool once per step, one call per reply, step 1 to 10 with of=10.");
    const child = await childOf("stopper");
    await until("stopper step 1", () => workStepsEnded(child.id) >= 1);
    const parentAssistants = await roleCount(root, "assistant");
    const tStop = Date.now();
    await child.abort(context);
    const stopMs = Date.now() - tStop;
    await sleep(1500);
    const ended = workStepsEnded(child.id);
    await settleReports();
    check("C3a", "host stop ends the child's work; parent gets no turn", !(await busy(child.id)) && ended < 10 && (await reportsFor("stopper")).length === 0, {
      abortResolvedMs: stopMs, workStepsEnded: ended, childBusy: await busy(child.id), rootBusy: await busy(root.id),
      parentAssistantsBefore: parentAssistants, parentAssistantsAfter: await roleCount(root, "assistant"), reports: await reportsFor("stopper"),
    });
  }

  // C3b: the parent's Esc does not reach a background child.
  {
    await say("Start a subagent named survivor: TASK-C run work 3 times. Call the work tool once per step, one call per reply, step 1 to 3 with of=3.");
    const child = await childOf("survivor");
    await until("survivor step 1", () => workStepsEnded(child.id) >= 1);
    await root.abort(context);
    await settleReports();
    check("C3b", "parent abort (Esc) leaves the background child running to completion", workStepsEnded(child.id) === 3 && (await reportsFor("survivor")).length === 1, {
      workStepsEnded: workStepsEnded(child.id), reports: await reportsFor("survivor"),
    });
  }

  // C5: a child question lands in the parent transcript with no parent model turn; the host answer reaches the child.
  {
    await say("Start a subagent named asker: TASK-Q ASK the user with the ask_user tool which colour the button should be, then reply with their answer.");
    const child = await childOf("asker");
    const question = await until("question posted", async () => {
      const items = (await harness.snapshot(Questions, root.id, context))?.items ?? {};
      return Object.entries(items).find(([, q]) => q.child === child.id);
    });
    await root.waitForIdle(context);
    const parentAssistantsAtQuestion = await roleCount(root, "assistant");
    const rootBusyAtQuestion = await busy(root.id);
    await sleep(1000);
    const parentAssistantsBeforeAnswer = await roleCount(root, "assistant");
    const questionEntries = (await entriesOf(root)).filter((e) => e.kind === "spike.child-question");
    // Host answers: one commit to the questions doc, one write entry for the transcript. No input, no turn.
    const [questionId] = question;
    await root.commit(async (tx) => { (await tx.doc(Questions, root.id)).items[questionId].answer = "Teal"; }, context);
    await root.submit({ type: "write", entry: { kind: "spike.child-answer", data: { questionId, answer: "Teal" } } }, context);
    const parentAssistantsRightAfterAnswer = await roleCount(root, "assistant");
    await until("asker idle", async () => !(await busy(child.id)) && (await assistantTexts(child)).some((t) => t.includes("Teal")), 90_000);
    await settleReports();
    check("C5", "child question is a parent write entry with no parent turn; answer reaches the child", questionEntries.length === 1
      && !rootBusyAtQuestion && parentAssistantsAtQuestion === parentAssistantsBeforeAnswer && parentAssistantsBeforeAnswer === parentAssistantsRightAfterAnswer
      && (await assistantTexts(child)).at(-1)?.includes("Teal") === true, {
      questionEntries: questionEntries.map((e) => ({ kind: e.kind, model: e.model ?? null, data: e.data })),
      rootBusyAtQuestion, parentAssistantsAtQuestion, parentAssistantsBeforeAnswer, parentAssistantsRightAfterAnswer,
      childLastAnswer: (await assistantTexts(child)).at(-1), reports: await reportsFor("asker"),
    });
  }

  // C4a: restart while the child is inside a tool call.
  {
    const conversationsBefore = (await allConversations()).length;
    await root.submit({ type: "input", content: "Start a subagent named runner: TASK-R run work 4 times. Call the work tool once per step, one call per reply, step 1 to 4 with of=4." }, context);
    const agent = await until("runner registered", () => agentOf("runner"));
    await until("runner step 2 started", () => workStepsStarted(agent.conversationId) >= 2);
    const reportersBefore = Object.keys((await harness.snapshot(Subagents, root.id, context)).reporters).length;
    await restart("child mid-tool");
    await until("runner finished", async () => (await reportsFor("runner")).length >= 1, 60_000);
    await settleReports();
    await sleep(500);
    const conversationsAfter = (await allConversations()).length;
    const steps = workAttempts().filter((a) => a.conv === agent.conversationId && a.phase === "end").map((a) => a.step);
    const reports = await reportsFor("runner");
    check("C4a", "restart mid-tool: child resumes, one child conversation, report delivered once", reports.length === 1
      && conversationsAfter === conversationsBefore + 1 && JSON.stringify([...new Set(steps)].sort()) === JSON.stringify([1, 2, 3, 4]), {
      conversationsBefore, conversationsAfter, reportersBefore,
      reportersAfter: Object.keys((await harness.snapshot(Subagents, root.id, context)).reporters).length,
      workStepEnds: steps, workAttempts: workAttempts().filter((a) => a.conv === agent.conversationId).map((a) => `${a.step}:${a.phase}:${a.pid}`), reports,
    });
  }

  // C4b: restart while the child waits on a question.
  {
    await root.submit({ type: "input", content: "Start a subagent named waiter: TASK-W ASK the user with the ask_user tool which colour the button should be, then reply with their answer." }, context);
    const agent = await until("waiter registered", () => agentOf("waiter"));
    const [questionId] = await until("waiter question", async () => {
      const items = (await harness.snapshot(Questions, root.id, context))?.items ?? {};
      return Object.entries(items).find(([, q]) => q.child === agent.conversationId);
    });
    await restart("child waiting on a question");
    await sleep(1000);
    const items = (await harness.snapshot(Questions, root.id, context)).items;
    const questionEntries = (await entriesOf(root)).filter((e) => e.kind === "spike.child-question" && e.data?.questionId === questionId);
    await root.commit(async (tx) => { (await tx.doc(Questions, root.id)).items[questionId].answer = "Amber"; }, context);
    const child = await harness.conversation(agent.conversationId, context);
    await until("waiter answered", async () => (await assistantTexts(child)).some((t) => t.includes("Amber")), 60_000);
    await settleReports();
    const askAttempts = workAttempts().filter((a) => a.tool === "ask_user" && a.questionId === questionId);
    check("C4b", "restart mid-question: same question kept, not duplicated, answer after restart reaches the child", questionEntries.length === 1
      && Object.keys(items).filter((k) => items[k].child === agent.conversationId).length === 1 && (await reportsFor("waiter")).length === 1, {
      questionId, questionEntriesInParent: questionEntries.length, askAttempts: askAttempts.map((a) => `${a.pid}:created=${a.created}`),
      childLastAnswer: (await assistantTexts(child)).at(-1), reports: await reportsFor("waiter"),
    });
  }

  const graph = await harness.taskGraph(context);
  log(`live tasks at end: ${Object.keys(graph.value.tasks).length}`);
  graph.dispose?.();
  const usage = await harness.usage(context);
  log(`usage models: ${Object.keys(usage.models ?? {}).join(", ")}`);
} catch (error) {
  log("ERROR", error?.stack ?? error);
  const agents = (await harness.snapshot(Subagents, root.id, context).catch(() => null))?.agents ?? {};
  for (const [name, agent] of Object.entries(agents)) {
    const child = await harness.conversation(agent.conversationId, context);
    const summary = (await entriesOf(child)).flatMap((e) => (e.model ?? []).map((m) => `${m.role}:${JSON.stringify(m.content).slice(0, 160)}`));
    log(`DUMP ${name} busy=${await busy(agent.conversationId)}\n  ${summary.slice(-8).join("\n  ")}`);
  }
  log(`DUMP questions ${JSON.stringify(await harness.snapshot(Questions, root.id, context).catch(() => null))}`);
  results.push({ id: "ERR", name: "scenario crashed", pass: false, evidence: String(error?.message ?? error) });
} finally {
  writeFileSync(join(import.meta.dirname, `results-${MODE}.json`), `${JSON.stringify({ mode: MODE, model, at: new Date().toISOString(), results }, null, 2)}\n`);
  await harness.close(context).catch(() => {});
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true });
  console.log("\n| id | pass | check |\n|---|---|---|");
  for (const r of results) console.log(`| ${r.id} | ${r.pass ? "yes" : "NO"} | ${r.name} |`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
