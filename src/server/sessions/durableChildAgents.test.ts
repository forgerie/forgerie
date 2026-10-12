// Durable-native child agents through Forgerie's real session service and Durable factory, with a scripted model.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { CHILD_NOTE_KIND, CHILD_QUESTION_KIND } from "./durableChildAgents.js";
import { modelChoice } from "./durableChildAgents.js";
import { LiveChildSessionIndex, createDurableChildHost } from "./durableChildHost.js";
import { ChildRunStore } from "./childRunStore.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execute("git", ["-C", cwd, ...args])).stdout.trim();

interface Attempt { conv: number; step: number; phase: "start" | "end" }
const attempts: Attempt[] = [];
const systemSeen: string[] = [];
/** Image parts a child's model received in tool results. */
const imagesSeen: string[] = [];

const work = defineTool({
  name: "work",
  description: "Do one step of work.",
  parameters: Type.Object({ step: Type.Number(), of: Type.Number() }),
  replay: "safe",
  executionMode: "sequential",
  execute: async (args, api) => {
    attempts.push({ conv: Number(api.conversationId), step: args.step, phase: "start" });
    await sleep(250);
    attempts.push({ conv: Number(api.conversationId), step: args.step, phase: "end" });
    return { content: [{ type: "text" as const, text: `work step ${String(args.step)}/${String(args.of)} done` }],
      usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
        cost: { input: 0.2, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.25 } } };
  },
});

const text = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? "").join("") : "";

/** One scripted model for the parent, every child, and title generation. It answers by the last message. */
const route: FauxResponseFactory = (context) => {
  const last = [...context.messages].reverse().find((message) => message.role !== "system");
  const said = text(last?.content);
  const call = (name: string, args: Record<string, string | number>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
  const answer = (value: string): AssistantMessage => fauxAssistantMessage([fauxText(value)]);
  // A child whose agent file carries a PROFILE marker: keep what its model was sent.
  const seen = JSON.stringify(context);
  if (said.includes("PROFILE") || seen.includes("PROFILE-")) systemSeen.push(seen);
  if (last?.role === "toolResult") {
    for (const part of Array.isArray(last.content) ? last.content : []) if (part.type === "image") imagesSeen.push(part.mimeType);
    if (said.startsWith("Started") || said.startsWith("Sent")) return answer(`OK. ${said}`);
    const step = /work step (\d+)\/(\d+) done/.exec(said);
    if (step !== null) return Number(step[1]) < Number(step[2]) ? call("work", { step: Number(step[1]) + 1, of: Number(step[2]) }) : answer(`All ${step[2] ?? ""} steps done.`);
    if (said.startsWith("The user answered:")) return answer(`Thanks. ${said}`);
    return answer(`Tool said: ${said}`);
  }
  if (said.startsWith("[subagent")) return answer("Noted.");
  if (said.startsWith("[the user")) return answer("Understood.");
  if (said.startsWith("STEER")) return answer("Steered: finishing early.");
  if (said === "FAIL") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Controlled child failure" });
  if (said === "Start three children in one reply") return fauxAssistantMessage(
    ["alpha", "beta", "gamma"].map((name) => fauxToolCall("child_agent", { action: "spawn", name, message: "run work 5 times" })),
    { stopReason: "toolUse" },
  );
  const send = /^Send child (\w+): ([\s\S]*)$/.exec(said);
  if (send !== null) return call("child_agent", { action: "send", name: send[1] ?? "", message: send[2] ?? "" });
  const spawn = /^Start a child named (\w+)(?: as (\w+))?(?: (isolated))?: ([\s\S]*)$/.exec(said);
  if (spawn !== null) return call("child_agent", { action: "spawn", name: spawn[1] ?? "", message: spawn[4] ?? "",
    ...(spawn[2] === undefined ? {} : { agent: spawn[2] }), ...(spawn[3] === undefined ? {} : { isolation: "worktree" }) });
  const steps = /run work (\d+) times/.exec(said);
  if (steps !== null) return call("work", { step: 1, of: Number(steps[1]) });
  const diff = /^DIFF (\S+)$/.exec(said);
  if (diff !== null) return call("watchdog_diff", { range: diff[1] ?? "" });
  const image = /^IMAGE (\S+)$/.exec(said);
  if (image !== null) return call("read", { path: image[1] ?? "" });
  const write = /WRITE (\S+) (.*)$/.exec(said);
  if (write !== null) return call("write", { path: write[1] ?? "", content: write[2] ?? "" });
  if (said.includes("ASK")) return call("ask_human", { question: "Which colour should the button be?" });
  return answer("Session title");
};

let directory = "";
let agentDir = "";
let models: ModelRuntime;
let index: LiveChildSessionIndex;
let hub: CapturingSessionEventHub;
let service: PiSessionService;
let worktrees: SessionWorktrees | undefined;
let runRecords: ChildRunStore;
const recordErrors: unknown[] = [];

async function gitWorkspace(beforeRemoval?: () => Promise<readonly []>): Promise<SessionWorktrees> {
  await git(directory, "init", "-b", "main");
  await git(directory, "config", "user.email", "test@example.invalid");
  await git(directory, "config", "user.name", "Test");
  await writeFile(join(directory, "base.txt"), "base\n");
  await git(directory, "add", "base.txt");
  await git(directory, "commit", "-m", "base");
  const store = new SessionWorktreeStore(join(directory, "ownership.json"));
  await store.initialize();
  worktrees = new SessionWorktrees(store, { publish: () => undefined, ...(beforeRemoval === undefined ? {} : { beforeRemoval }) });
  await service.dispose();
  service = openService();
  return worktrees;
}

function openService(): PiSessionService {
  hub = new CapturingSessionEventHub();
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
  return new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(),
    heartbeatIntervalMs: 60_000, durableChildAgents: createDurableChildHost({ extraTools: [work], index, runRecords, onRunRecordError: (error) => { recordErrors.push(error); }, ...(worktrees === undefined ? {} : { worktrees }) }) });
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

interface Message { role?: string; content?: unknown; customType?: string; details?: { questionId?: string } }
interface Ref { id: string; cwd: string }
const transcript = async (ref: Ref): Promise<Message[]> => (await service.messages(ref, { limit: 500 })).messages.flatMap((message) => typeof message === "object" && message !== null ? [message] : []);
const reports = async (ref: Ref, name: string) => (await transcript(ref)).filter((m) => m.role === "user" && text(m.content).startsWith(`[subagent ${name} `));
const parentAnswers = async (ref: Ref) => (await transcript(ref)).filter((m) => m.role === "assistant").length;
const child = async (ref: Ref, name: string) => until(`child ${name}`, async () => (await service.durableChildren(ref)).find((c) => c.name === name));
const childText = async (ref: Ref, conversationId: number) => (await service.durableChildMessages(ref, conversationId)).messages.map((m) => `${m.role}: ${text(m.content)}`);
const ended = (conv: number) => attempts.filter((a) => a.conv === conv && a.phase === "end");

beforeEach(async () => {
  attempts.length = 0;
  systemSeen.length = 0;
  imagesSeen.length = 0;
  worktrees = undefined;
  recordErrors.length = 0;
  directory = await mkdtemp(join(tmpdir(), "forgerie-durable-children-"));
  agentDir = join(directory, "agent");
  runRecords = new ChildRunStore(join(agentDir, "child-runs.json"));
  models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 400 });
  models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 400 }, () => route));
  index = new LiveChildSessionIndex(join(directory, "live-children.json"));
  service = openService();
});
afterEach(async () => {
  await service.dispose();
  await rm(directory, { recursive: true, force: true });
  expect(recordErrors).toEqual([]);
});

describe("Durable-native child agents in a Forgerie session", () => {
  it("reviews real changes, lands, and continues once in a fresh default-branch checkout after restart", async () => {
    await gitWorkspace();
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named builder isolated: WRITE result.txt first result");
    const builder = await child(ref, "builder");
    await until("builder report", async () => (await reports(ref, "builder")).length === 1);
    if (builder.worktree === undefined) throw new Error("Expected isolated child");
    const path = builder.worktree.path;
    expect((await service.reviewDurableChildWorktree(ref, builder.conversationId)).untracked).toContain("result.txt");
    await git(path, "add", "result.txt");
    await git(path, "commit", "-m", "first child change");
    const review = await service.reviewDurableChildWorktree(ref, builder.conversationId);
    expect(review.sections[0]?.diff).toContain("+first result");
    expect(await service.landDurableChildWorktree(ref, builder.conversationId)).toMatchObject({ kind: "landed" });
    await expect(service.reviewDurableChildWorktree(ref, 999999)).rejects.toThrow("not a child");
    await expect(service.reviewDurableChildWorktree(ref, builder.conversationId)).rejects.toThrow("no longer");
    const next = await service.continueDurableChild(ref, builder.conversationId, "WRITE next.txt second result", "request-1");
    await until("continuation report", async () => (await reports(ref, "builder-2")).length === 1);
    const continued = await child(ref, "builder-2");
    expect(continued.conversationId).toBe(next.conversationId);
    expect(continued.worktree?.path).not.toBe(path);
    if (continued.worktree === undefined) throw new Error("Expected isolated continuation");
    expect(await readFile(join(continued.worktree.path, "result.txt"), "utf8")).toBe("first result");
    expect(await readFile(join(continued.worktree.path, "next.txt"), "utf8")).toBe("second result");
    await service.dispose(); service = openService();
    expect(await service.continueDurableChild(ref, builder.conversationId, "WRITE next.txt second result", "request-1")).toEqual(next);
    expect(await service.durableChildren(ref)).toHaveLength(2);
    await expect(service.continueDurableChild(ref, builder.conversationId, "different", "request-1")).rejects.toThrow("another task");
  }, 15_000);

  it("includes inherited parent commits in the landing review", async () => {
    await gitWorkspace();
    await git(directory, "checkout", "-b", "parent-feature");
    await writeFile(join(directory, "inherited.txt"), "inherited parent change");
    await git(directory, "add", "inherited.txt"); await git(directory, "commit", "-m", "parent change");
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named builder isolated: WRITE child.txt child change");
    const builder = await child(ref, "builder");
    await until("builder report", async () => (await reports(ref, "builder")).length === 1);
    if (!builder.worktree) throw new Error("Expected isolated child");
    await git(builder.worktree.path, "add", "child.txt"); await git(builder.worktree.path, "commit", "-m", "child change");
    const review = await service.reviewDurableChildWorktree(ref, builder.conversationId);
    expect(review.sections[0]?.diff).toContain("+inherited parent change");
    expect(review.sections[0]?.diff).toContain("+child change");
  });

  it("closes unanswered questions when the user stops the child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named asking: ASK");
    const asking = await until("question", async () => (await service.durableChildren(ref)).find((item) => item.questions.length > 0));
    await service.stopDurableChild(ref, asking.conversationId);
    expect((await child(ref, "asking")).questions).toEqual([]);
    const question = asking.questions[0];
    if (question === undefined) throw new Error("Expected a question");
    await expect(service.answerDurableChildQuestion(ref, question.questionId, "Too late")).rejects.toThrow("is not open");
  });

  it("records separate idle inputs with their own committed tool spend and turn count", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named accounting: run work 1 times");
    const helper = await child(ref, "accounting");
    const first = await until("first accounting run", async () => (await runRecords.list({ session: ref.id })).find((row) => row.child.name === "accounting" && row.state.kind === "finished"));
    expect(first.turns).toBe(2);
    expect(first.usage?.tools["work"]).toMatchObject({ input: 7, output: 3, totalTokens: 10, cost: { total: 0.25 } });
    expect(Object.values(first.usage?.models ?? {}).reduce((sum, usage) => sum + usage.totalTokens, 0)).toBeGreaterThan(0);
    expect(first.state.kind).toBe("finished");
    if (first.state.kind === "finished") expect(first.state.durationMs).toBe(first.state.finishedAt - first.startedAt);
    await service.messageDurableChild(ref, helper.conversationId, "run work 1 times");
    const rows = await until("second accounting run", async () => { const rows = await runRecords.list({ session: ref.id }); return rows.length === 2 && rows.every((row) => row.state.kind === "finished") ? rows : false; });
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    for (const row of rows) { expect(row.turns).toBe(2); expect(row.usage?.tools["work"]?.cost.total).toBe(0.25); }
    await service.dispose(); service = openService();
    expect(await runRecords.list({ session: ref.id })).toEqual(rows);
  }, 30_000);

  it("records a model failure without claiming an answer", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named failure: FAIL");
    const row = await until("failed run record", async () => (await runRecords.list({ session: ref.id })).find((row) => row.child.name === "failure" && row.state.kind === "finished"));
    expect(row.state).toMatchObject({ kind: "finished", outcome: "failed" });
    expect(row.turns).toBe(1);
    expect(row.model).not.toBeNull();
    expect(await reports(ref, "failure")).toHaveLength(1);
  }, 30_000);

  it("lists a child, reads it, and delivers a user steer that the parent also sees", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named builder: run work 4 times");
    const builder = await child(ref, "builder");
    expect(builder).toMatchObject({ busy: true, agent: null, questions: [] });
    await until("builder step 1", () => Promise.resolve(ended(builder.conversationId).length >= 1));
    await service.messageDurableChild(ref, builder.conversationId, "STEER: finish now");
    await until("builder report", async () => (await reports(ref, "builder")).length === 1);
    const users = (await service.durableChildMessages(ref, builder.conversationId)).messages.filter((m) => m.role === "user").map((m) => text(m.content));
    expect(users).toEqual(["run work 4 times", "STEER: finish now"]);
    expect(ended(builder.conversationId).length).toBeLessThan(4);
    const parent = await transcript(ref);
    // The parent sees the steer as a card for the user and as context for its model.
    expect(parent.find((m) => m.customType === CHILD_NOTE_KIND)?.content).toBe("You told builder: STEER: finish now");
    // The tool result links the call to the child view.
    expect(JSON.stringify(parent)).toContain(`"conversationId":${String(builder.conversationId)}`);
    const rows = await until("builder run record", async () => { const rows = await runRecords.list({ session: ref.id }); return rows[0]?.state.kind === "finished" ? rows : false; });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ child: { name: "builder", agent: null }, state: { kind: "finished", outcome: "answered" } });
    expect(rows[0]?.turns).toBeGreaterThan(1);
  }, 30_000);

  it("gives a general child Durable's coding tools in the session's folder", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named writer: WRITE out.txt hello from a child");
    await until("writer report", async () => (await reports(ref, "writer")).length === 1);
    expect(await readFile(join(directory, "out.txt"), "utf8")).toBe("hello from a child");
  }, 30_000);

  it("runs a child from a project agent file with its prompt and only its tools", async () => {
    await mkdir(join(directory, ".pi", "agents"), { recursive: true });
    await writeFile(join(directory, ".pi", "agents", "reader.md"), "---\nname: reader\ndescription: Reads only\ntools: read\n---\nYou only read files. PROFILE-MARKER\n");
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named looker as reader: PROFILE WRITE blocked.txt nope");
    const looker = await child(ref, "looker");
    expect(looker.agent).toBe("reader");
    await until("looker report", async () => (await reports(ref, "looker")).length === 1);
    // Durable sends instructions and the offered tools as system sections.
    const childRequest = systemSeen.find((request) => request.includes("PROFILE-MARKER")) ?? "";
    expect(childRequest).toContain("\"name\":\"read\"");
    expect(childRequest).not.toContain("\"name\":\"write\"");
    await expect(readFile(join(directory, "blocked.txt"), "utf8")).rejects.toThrow();
    const rows = await until("agent file run record", async () => { const rows = await runRecords.list({ agent: "reader" }); return rows[0]?.state.kind === "finished" ? rows : false; });
    const path = join(directory, ".pi", "agents", "reader.md");
    expect(rows[0]?.child.agentFile).toEqual({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
    expect(rows[0]?.session).toEqual(ref);
    expect(rows[0]?.model).not.toBeNull();
    // An unknown agent name is an error result, not a child.
    await service.prompt(ref, "Start a child named ghost as nobody: hello");
    await sleep(300);
    expect((await service.durableChildren(ref)).map((c) => c.name)).toEqual(["looker"]);
  }, 30_000);

  it("runs a pi-subagents reviewer file with a committed-range diff, image reads, and the gaps reported to the parent", async () => {
    await git(directory, "init", "-b", "main");
    await git(directory, "config", "user.email", "test@example.invalid");
    await git(directory, "config", "user.name", "Test");
    await writeFile(join(directory, "base.txt"), "base\n");
    await git(directory, "add", "base.txt");
    await git(directory, "commit", "-m", "base");
    await writeFile(join(directory, "base.txt"), "base\nRANGE-CHANGE\n");
    await git(directory, "commit", "-am", "Change in range");
    // A one-pixel PNG.
    await writeFile(join(directory, "shot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await mkdir(join(directory, ".pi", "agents"), { recursive: true });
    await writeFile(join(directory, ".pi", "agents", "checker.md"), "---\nname: checker\ndescription: Reviews\ntools: read, grep, watchdog_diff, contact_supervisor, missing_tool\n---\nDo not use shell commands. PROFILE-CHECKER\n");
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named differ as checker: DIFF main~1..main");
    await until("differ report", async () => (await reports(ref, "differ")).length === 1);
    const report = text((await reports(ref, "differ"))[0]?.content);
    expect(report).toContain("Change in range");
    expect(report).toContain("+RANGE-CHANGE");
    const spawned = (await transcript(ref)).find((m) => m.role === "toolResult" && text(m.content).startsWith("Started differ"));
    expect(text(spawned?.content)).toBe("Started differ (checker). Not available to it here: tools missing_tool.");
    const instructions = systemSeen.find((request) => request.includes("PROFILE-CHECKER")) ?? "";
    expect(instructions).toContain("## This runtime");
    expect(instructions).toContain("contact_supervisor is ask_human here");
    expect(instructions).toContain("\"name\":\"watchdog_diff\"");
    expect(instructions).not.toContain("\"name\":\"write\"");
    await service.prompt(ref, "Start a child named looker as checker: IMAGE shot.png");
    await until("looker report", async () => (await reports(ref, "looker")).length === 1);
    expect(imagesSeen).toEqual(["image/png"]);
    expect(text((await reports(ref, "looker"))[0]?.content)).toContain("shot.png: image/png");
  }, 30_000);

  it("re-reads a child's agent file on each send, so a long-lived child gets the current tools and instructions", async () => {
    await mkdir(join(directory, ".pi", "agents"), { recursive: true });
    const path = join(directory, ".pi", "agents", "keeper.md");
    await writeFile(path, "---\nname: keeper\ndescription: Reads\ntools: read\n---\nPROFILE-OLD\n");
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named kept as keeper: hello");
    await until("first report", async () => (await reports(ref, "kept")).length === 1);
    const first = systemSeen.find((request) => request.includes("PROFILE-OLD")) ?? "";
    expect(first).not.toContain("\"name\":\"watchdog_diff\"");
    await writeFile(path, "---\nname: keeper\ndescription: Reads\ntools: read, watchdog_diff\n---\nPROFILE-NEW\n");
    await until("parent idle", async () => !(await service.status(ref)).isStreaming);
    await service.prompt(ref, "Send child kept: again");
    await until("second report", async () => (await reports(ref, "kept")).length === 2);
    const second = systemSeen.find((request) => request.includes("PROFILE-NEW")) ?? "";
    expect(second).toContain("\"name\":\"watchdog_diff\"");
    expect(second).toContain("watchdog_diff reads committed ranges here");
    // Durable keeps earlier instructions in the child's history; the current ones follow them.
    expect(second.lastIndexOf("PROFILE-NEW")).toBeGreaterThan(second.lastIndexOf("PROFILE-OLD"));
    // The run record of the second run names the file it ran with.
    const sha = createHash("sha256").update(await readFile(path)).digest("hex");
    await until("second run record", async () => (await runRecords.list({ agent: "keeper" })).some((row) => row.child.agentFile?.sha256 === sha));
  }, 30_000);

  it("stops a child without a parent turn, and Esc in the parent does not reach a child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named stopper: run work 10 times");
    const stopper = await child(ref, "stopper");
    await until("stopper step 1", () => Promise.resolve(ended(stopper.conversationId).length >= 1));
    await until("parent idle", async () => !(await service.status(ref)).isStreaming);
    const answersBefore = await parentAnswers(ref);
    await service.stopDurableChild(ref, stopper.conversationId);
    await sleep(800);
    expect(ended(stopper.conversationId).length).toBeLessThan(10);
    expect((await service.durableChildren(ref)).find((c) => c.name === "stopper")?.busy).toBe(false);
    expect(await reports(ref, "stopper")).toHaveLength(0);
    const stopped = (await runRecords.list({ session: ref.id })).find((row) => row.child.name === "stopper");
    expect(stopped?.state).toMatchObject({ kind: "finished", outcome: "stopped" });
    expect(await parentAnswers(ref)).toBe(answersBefore);
    expect((await transcript(ref)).some((m) => m.customType === CHILD_NOTE_KIND && text(m.content) === "You stopped stopper.")).toBe(true);
    await service.prompt(ref, "Start a child named survivor: run work 3 times");
    const survivor = await child(ref, "survivor");
    await until("survivor step 1", () => Promise.resolve(ended(survivor.conversationId).length >= 1));
    await service.abort(ref);
    await until("survivor report", async () => (await reports(ref, "survivor")).length === 1);
    expect(ended(survivor.conversationId)).toHaveLength(3);
  }, 30_000);

  it("shows a child question in the parent with no parent turn, and the answer reaches the child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named asker: ASK the user");
    const asker = await child(ref, "asker");
    const question = await until("question in transcript", async () => (await transcript(ref)).find((m) => m.customType === CHILD_QUESTION_KIND));
    await until("parent idle", async () => !(await service.status(ref)).isStreaming);
    const answersAtQuestion = await parentAnswers(ref);
    await sleep(600);
    expect(text(question.content)).toBe("asker asks: Which colour should the button be?");
    expect(await parentAnswers(ref)).toBe(answersAtQuestion);
    const listed = (await service.durableChildren(ref)).find((c) => c.name === "asker");
    expect(listed?.questions.map((q) => q.question)).toEqual(["Which colour should the button be?"]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.end" && JSON.stringify(event.message).includes(CHILD_QUESTION_KIND))).toBe(true);
    expect(hub.sessionEvents.some(({ event }) => event.type === "pi.event" && event.eventType === "durable_children_changed")).toBe(true);
    // The session list reads this count to put the session under "Needs your response".
    await until("waiting count", async () => (await service.status(ref)).waitingOnYou === 1);
    const questionId = String(question.details?.questionId);
    await service.answerDurableChildQuestion(ref, questionId, "Teal");
    await until("waiting cleared", async () => (await service.status(ref)).waitingOnYou === undefined);
    expect(await parentAnswers(ref)).toBe(answersAtQuestion);
    await until("asker report", async () => (await reports(ref, "asker")).length === 1);
    expect(await childText(ref, asker.conversationId)).toContain("toolResult: The user answered: Teal");
    await expect(service.answerDurableChildQuestion(ref, questionId, "Again")).rejects.toThrow("is not open");
  }, 30_000);

  it("recovers live child work from journals after the external child index is lost", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named runner: run work 5 times");
    const runner = await child(ref, "runner");
    await until("runner step 2 started", () => Promise.resolve(attempts.filter((a) => a.conv === runner.conversationId && a.phase === "start").length >= 2));
    expect(await until("index lists the session", async () => (await index.list()).length === 1 && index.list())).toEqual([ref]);
    const before = (await runRecords.list({ session: ref.id }))[0];
    expect(before?.state.kind).toBe("running");
    await service.dispose();
    const stepsAtStop = ended(runner.conversationId).length;
    await rm(join(directory, "live-children.json"));
    runRecords = new ChildRunStore(join(agentDir, "child-runs.json"));
    index = new LiveChildSessionIndex(join(directory, "live-children.json"));
    service = openService();
    await sleep(800);
    expect(ended(runner.conversationId).length).toBe(stepsAtStop);
    expect(await index.list()).toEqual([]);
    expect(await service.resumeDurableSessions()).toEqual({ resumed: [ref.id], failed: [] });
    await until("runner report after resume", async () => (await reports(ref, "runner")).length === 1, 20_000);
    expect([...new Set(ended(runner.conversationId).map((a) => a.step))].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await service.durableChildren(ref)).toHaveLength(1);
    const rows = await until("recovered run record", async () => { const rows = await runRecords.list({ session: ref.id }); return rows[0]?.state.kind === "finished" ? rows : false; });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]?.startedAt).toBe(before?.startedAt);
    expect(rows[0]?.turns).toBe(6);
    expect(rows[0]?.usage?.tools["work"]?.cost.total).toBe(1.25);
    await until("index empties", async () => (await index.list()).length === 0);
  }, 40_000);

  it("recovers a lost completion write from an unfinished checkpoint after the live index clears", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named receipt: run work 2 times");
    const helper = await child(ref, "receipt");
    await until("receipt tool started", () => Promise.resolve(attempts.some((attempt) => attempt.conv === helper.conversationId && attempt.phase === "start")));
    const path = join(agentDir, "child-runs.json");
    const runningSnapshot = await readFile(path, "utf8");
    await until("receipt report", async () => (await reports(ref, "receipt")).length === 1);
    const original = await until("receipt record complete", async () => (await runRecords.list({ session: ref.id })).find((row) => row.state.kind === "finished"));
    await until("receipt live index cleared", async () => (await index.list()).length === 0);
    await service.dispose();
    // Reproduce a crash between the Durable completion commit and its external history-file write.
    await writeFile(path, runningSnapshot);
    runRecords = new ChildRunStore(path);
    service = openService();
    const refs = (await runRecords.pending()).map(({ run }) => run.session);
    expect(refs).toEqual([ref]);
    expect(await service.resumeDurableSessions(refs)).toEqual({ resumed: [ref.id], failed: [] });
    const recovered = (await runRecords.list({ session: ref.id }))[0];
    expect(recovered).toMatchObject({ id: original.id, startedAt: original.startedAt, turns: 3, usage: original.usage, state: { kind: "finished", outcome: "answered", timing: "recovered" } });
    if (original.state.kind === "finished" && recovered?.state.kind === "finished") expect(recovered.state.finishedAt).toBe(original.state.finishedAt);
    expect(await reports(ref, "receipt")).toHaveLength(1);
  }, 30_000);

  it("runs three children in parallel and resumes each with one report after restart", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start three children in one reply");
    const initial = await until("three children", async () => {
      const listed = await service.durableChildren(ref);
      return listed.length === 3 ? listed : undefined;
    });
    const ids = initial.map((item) => item.conversationId);
    await until("all children in step two", () => Promise.resolve(ids.every((id) => attempts.some((a) => a.conv === id && a.step === 2 && a.phase === "start"))));
    // All three first tools start before any ends. This proves parallel work, not just three queued spawns.
    const firstEnd = attempts.findIndex((attempt) => attempt.phase === "end");
    expect(new Set(attempts.slice(0, firstEnd).map((attempt) => attempt.conv)).size).toBe(3);
    await until("live index", async () => (await index.list()).length === 1);
    const originalRecords = await runRecords.list({ session: ref.id });
    expect(originalRecords).toHaveLength(3);
    await service.dispose();
    index = new LiveChildSessionIndex(join(directory, "live-children.json"));
    service = openService();
    expect(await service.resumeDurableSessions(await index.list())).toEqual({ resumed: [ref.id], failed: [] });
    await until("one report per child", async () => (await Promise.all(initial.map((item) => reports(ref, item.name)))).every((items) => items.length === 1), 20_000);
    await until("all children idle", async () => (await service.durableChildren(ref)).every((item) => !item.busy));
    expect((await service.durableChildren(ref)).map((item) => [item.name, item.conversationId])).toEqual(initial.map((item) => [item.name, item.conversationId]));
    for (const item of initial) {
      expect(await reports(ref, item.name)).toHaveLength(1);
      expect([...new Set(ended(item.conversationId).map((attempt) => attempt.step))].sort()).toEqual([1, 2, 3, 4, 5]);
    }
    const records = await until("three completed run records", async () => { const rows = await runRecords.list({ session: ref.id }); return rows.length === 3 && rows.every((row) => row.state.kind === "finished") ? rows : false; });
    expect(records.map((row) => row.id).sort()).toEqual(originalRecords.map((row) => row.id).sort());
    for (const row of records) { expect(row.turns).toBe(6); expect(row.usage?.tools["work"]?.cost.total).toBe(1.25); }
    await until("index cleared", async () => (await index.list()).length === 0);
    await service.dispose();
    service = openService();
    await service.status(ref);
    for (const item of initial) expect(await reports(ref, item.name)).toHaveLength(1);
    expect(await runRecords.list({ session: ref.id })).toEqual(records);
  }, 40_000);

  it("isolates writers, reports their branch and files, and preserves cwd across reopen", async () => {
    const lifecycle = await gitWorkspace();
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    for (const name of ["one", "two"]) {
      await service.prompt(ref, `Start a child named ${name} isolated: WRITE out.txt ${name}`);
      await until(`${name} report`, async () => (await reports(ref, name)).length === 1);
    }
    const before = await service.durableChildren(ref);
    expect(before).toHaveLength(2);
    expect(new Set(before.map((item) => item.worktree?.path)).size).toBe(2);
    for (const item of before) {
      if (item.worktree === undefined) throw new Error("Expected isolated cwd");
      expect(item.worktree).toMatchObject({ state: "active", ahead: 0, dirty: true });
      expect(await readFile(join(item.worktree.path, "out.txt"), "utf8")).toBe(item.name);
      expect(text((await reports(ref, item.name))[0]?.content)).toContain(`Worktree branch: ${item.worktree.branch}`);
      expect(text((await reports(ref, item.name))[0]?.content)).toContain("Files changed: out.txt");
    }
    await expect(readFile(join(directory, "out.txt"))).rejects.toThrow();
    await service.dispose();
    service = openService();
    const ownedPath = before[0]?.worktree?.path;
    if (ownedPath === undefined) throw new Error("Expected isolated cwd");
    // An unopened parent still owns its child's folder while its session stays unarchived.
    expect(await service.worktreeHasLiveSession(ownedPath, ref.id)).toBe(true);
    expect(await service.worktreeHasLiveSession(ownedPath)).toBe(false);
    expect(await service.durableChildren(ref)).toEqual(before);
    expect(await lifecycle.store.list()).toHaveLength(2);
    await service.messageDurableChild(ref, before[0]?.conversationId ?? 0, "WRITE after.txt reopened child");
    const path = before[0]?.worktree?.path;
    if (path === undefined) throw new Error("Expected isolated cwd");
    await until("write in reopened child", async () => readFile(join(path, "after.txt"), "utf8").catch(() => false));
    await expect(readFile(join(directory, "after.txt"))).rejects.toThrow();
  }, 40_000);

  it("lands a finished child's commit, keeps its history, and rejects new work in the removed cwd", async () => {
    await gitWorkspace();
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named builder isolated: WRITE result.txt landed child");
    await until("builder report", async () => (await reports(ref, "builder")).length === 1);
    const builder = await child(ref, "builder");
    if (builder.worktree === undefined) throw new Error("Expected child worktree");
    await git(builder.worktree.path, "add", "result.txt");
    await git(builder.worktree.path, "commit", "-m", "child result");
    expect((await child(ref, "builder")).worktree).toMatchObject({ ahead: 1, dirty: false });
    expect(await service.landDurableChildWorktree(ref, builder.conversationId)).toMatchObject({ kind: "landed", cleanup: { kind: "done" } });
    expect(await readFile(join(directory, "result.txt"), "utf8")).toBe("landed child");
    await expect(readFile(join(builder.worktree.path, "result.txt"))).rejects.toThrow();
    expect((await child(ref, "builder")).worktree).toMatchObject({ state: "landed", dirty: false });
    expect((await service.durableChildMessages(ref, builder.conversationId)).messages.length).toBeGreaterThan(0);
    await expect(service.messageDurableChild(ref, builder.conversationId, "WRITE forbidden.txt no")).rejects.toThrow("no longer writable");
  }, 40_000);

  it("serializes a user submission with removal and refuses writes in a landed checkout", async () => {
    let release!: () => void;
    let entered!: () => void;
    const removing = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    await gitWorkspace(async () => { entered(); await released; return []; });
    const ref = await service.start(directory);
    await service.prompt(ref, "Start a child named racer isolated: WRITE same.txt committed");
    const writer = await child(ref, "racer");
    await until("racer report", async () => (await reports(ref, "racer")).length === 1);
    const path = writer.worktree?.path;
    if (path === undefined) throw new Error("Missing child checkout");
    await git(path, "add", "same.txt");
    await git(path, "commit", "-m", "child change");
    const landing = service.landDurableChildWorktree(ref, writer.conversationId);
    await removing;
    const submission = service.messageDurableChild(ref, writer.conversationId, "WRITE after.txt unsafe")
      .then(() => "accepted", () => "refused");
    release();
    const [landed, sent] = await Promise.all([landing, submission]);
    expect(landed.kind).toBe("landed");
    expect(sent).toBe("refused");
    await expect(readFile(join(path, "after.txt"))).rejects.toThrow();
  });

  it("refuses busy child removal, then requires a current discard token and keeps a receipt after restart", async () => {
    await gitWorkspace();
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named runner isolated: run work 10 times");
    const runner = await child(ref, "runner");
    if (runner.worktree === undefined) throw new Error("Expected child worktree");
    await until("working count", async () => (await service.status(ref)).workingAgents === 1);
    await expect(service.landDurableChildWorktree(ref, runner.conversationId)).rejects.toThrow("Stop the child");
    await expect(service.previewDurableChildWorktreeDiscard(ref, runner.conversationId)).rejects.toThrow("Stop the child");
    await service.stopDurableChild(ref, runner.conversationId);
    await until("idle child", async () => !(await child(ref, "runner")).busy);
    await writeFile(join(runner.worktree.path, "dirty.txt"), "first");
    const preview = await service.previewDurableChildWorktreeDiscard(ref, runner.conversationId);
    if (!("confirmationToken" in preview)) throw new Error("Expected discard preview");
    await writeFile(join(runner.worktree.path, "dirty.txt"), "changed");
    expect(await service.discardDurableChildWorktree(ref, runner.conversationId, preview.confirmationToken)).toMatchObject({ kind: "stale-preview" });
    const next = await service.previewDurableChildWorktreeDiscard(ref, runner.conversationId);
    if (!("confirmationToken" in next)) throw new Error("Expected discard preview");
    expect(await service.discardDurableChildWorktree(ref, runner.conversationId, next.confirmationToken)).toMatchObject({ kind: "discarded", cleanup: { kind: "done" } });
    await service.dispose();
    service = openService();
    expect((await child(ref, "runner")).worktree).toMatchObject({ state: "discarded", ahead: 0, dirty: false });
    await expect(service.messageDurableChild(ref, runner.conversationId, "new work")).rejects.toThrow("no longer writable");
  }, 40_000);

  it("keeps one question across a restart, and an answer after it reaches the child", async () => {
    const ref = { id: (await service.start(directory)).id, cwd: directory };
    await service.prompt(ref, "Start a child named waiter: ASK the user");
    const question = await until("question", async () => (await transcript(ref)).find((m) => m.customType === CHILD_QUESTION_KIND));
    await service.dispose();
    service = openService();
    await service.resumeDurableSessions([ref]);
    await sleep(800);
    expect((await transcript(ref)).filter((m) => m.customType === CHILD_QUESTION_KIND)).toHaveLength(1);
    await service.answerDurableChildQuestion(ref, String(question.details?.questionId), "Amber");
    await until("waiter report", async () => (await reports(ref, "waiter")).length === 1, 20_000);
    expect(text((await reports(ref, "waiter"))[0]?.content)).toContain("Amber");
  }, 40_000);
});

describe("a model named for one spawn", () => {
  it("reads provider/model-id with an optional thinking level and refuses anything else", () => {
    expect(modelChoice("anthropic/claude-opus-5.5")).toEqual({ model: { provider: "anthropic", modelId: "claude-opus-5.5" } });
    expect(modelChoice("cliproxyapi/gpt-6.1:high")).toEqual({ model: { provider: "cliproxyapi", modelId: "gpt-6.1" }, thinkingLevel: "high" });
    // A colon that is not a thinking level belongs to the model id.
    expect(modelChoice("local/qwen:32b")).toEqual({ model: { provider: "local", modelId: "qwen:32b" } });
    for (const bad of ["gpt-6.1", "/gpt", "anthropic/", ""]) expect(modelChoice(bad)).toBeNull();
  });
});
