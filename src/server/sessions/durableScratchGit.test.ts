import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, ToolTask, createRegistry, defineExtension, defineTool, type ConversationId, type JsonObject } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Type } from "typebox";
import { afterEach, expect, it } from "vitest";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { SCRATCH_ROOT } from "./disposableWorktrees.js";
import { durableChildExtensions, listChildren } from "./durableChildAgents.js";
import { gatedActions, gatedActionsExtension } from "./durableGatedActions.js";
import { ScratchGitLedger, scratchBranchReader, scratchGitExtension, scratchGitTool } from "./durableScratchGit.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";

const run = promisify(execFile);
const env = { ...sanitizedGitEnv(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = async (cwd: string, args: readonly string[]) => (await run("git", ["-C", cwd, ...args], { env, encoding: "utf8" })).stdout;
const roots: string[] = []; const journals: DurableSessionJournal[] = [];
afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(SCRATCH_ROOT, "forgerie-durable-scratch-"))); roots.push(root);
  const repo = join(root, "repo");
  await run("git", ["init", "-q", "-b", "main", repo], { env }); await git(repo, ["commit", "-qm", "Base", "--allow-empty"]);
  let manager = SessionManager.create(repo, join(root, "sessions"));
  manager.appendMessage(fauxAssistantMessage("Prior context"));
  const models = createModels(); const provider = fauxProvider({ tokensPerSecond: 100000 }); models.setProvider(provider.provider);
  provider.setResponses(Array.from({ length: 100 }, () => fauxAssistantMessage("Done")));
  const tool = scratchGitTool({ git, scratchRoot: join(root, "scratch"), now: () => 1, backup: { git, directory: join(root, "backups"), now: () => new Date() } });
  const bash = defineTool({ name: "bash", description: "Run commands", parameters: Type.Object({ command: Type.String() }), execute: async (args, api, ctx) => {
    const result = await run("bash", ["-c", args.command], { cwd: (await api.agent(ctx)).cwd ?? repo, env });
    return { content: [{ type: "text" as const, text: result.stdout }] };
  } });
  let journal: DurableSessionJournal;
  const open = async () => {
    const registry = createRegistry();
    const children = durableChildExtensions({ extraTools: [tool] });
    const tools = defineExtension({ name: "test.tools", tools: [bash] }); const scratch = scratchGitExtension(tool);
    for (const extension of [...children.parent, ...children.childOnly, tools, scratch]) registry.install(extension);
    journal = await DurableSessionJournal.open({ manager, models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? repo }),
      agent: { cwd: repo, model: { provider: "faux", modelId: "faux-1" }, extensions: [...children.parent, tools, scratch] } });
    journals.push(journal);
    const parent = journal.conversation.id;
    const gate = gatedActionsExtension({ parent, harness: () => journal.harness, reads: { git, issueLabels: () => Promise.resolve([]), disposable: () => Promise.resolve(false),
      scratchBranches: scratchBranchReader(() => journal.harness, parent, git, context) } });
    registry.install(gate); await journal.conversation.configure({ extensions: { add: [gate] } }, context);
  };
  await open();
  return { root, repo, get journal() { return journal; }, reopen: async () => {
    await journal.close(); const file = manager.getSessionFile(); if (file === undefined) throw new Error("No session file");
    manager = SessionManager.open(file); await open();
  } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function call(f: Fixture, name: string, args: JsonObject, target: ConversationId = f.journal.conversation.id) {
  const id = `call-${String(Math.random()).slice(2)}`;
  const task = await f.journal.conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, target, { model: [fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" })] });
    return tx.createTask(ToolTask, { assistant: entry.id, callId: id }, { conversationId: target, ownership: { kind: "conversation" } });
  }, context);
  f.journal.harness.resume();
  await f.journal.harness.waitForTask(task, context);
}
const ledger = async (f: Fixture, conversation: ConversationId = f.journal.conversation.id) => await f.journal.harness.snapshot(ScratchGitLedger, conversation, context);
const exists = (path: string) => stat(path).then(() => true, () => false);

it("records a parent's scratch tree in its Durable ledger, keeps it through a new runtime, and retires it on remove", async () => {
  const f = await fixture();
  await call(f, "scratch_git", { action: "create_worktree", name: "probe" });
  const tree = (await ledger(f))?.trees["probe"];
  expect(tree).toMatchObject({ kind: "worktree", repo: f.repo, conversation: Number(f.journal.conversation.id) });
  expect(tree?.path.startsWith(join(f.root, "scratch", (await ledger(f))?.root ?? "missing"))).toBe(true);
  await f.reopen();
  expect((await ledger(f))?.trees["probe"]).toEqual(tree);
  await call(f, "scratch_git", { action: "remove", name: "probe" });
  expect((await ledger(f))?.trees).toEqual({});
  expect(await exists(tree?.path ?? "")).toBe(false);
});

it("writes a child's scratch work into the parent's ledger, where the family can clean it up without a gate", async () => {
  const f = await fixture();
  await call(f, "child_agent", { action: "spawn", name: "helper", message: "Work", isolation: "shared" });
  const child = (await listChildren(f.journal.harness, f.journal.conversation.id, context))[0]; if (child === undefined) throw new Error("No child");
  const target = await f.journal.harness.commit(async tx => (await tx.scanConversations({}, 100)).items.find(record => Number(record.id) === child.conversationId)?.id, context);
  if (target === undefined) throw new Error("No child conversation");
  await call(f, "scratch_git", { action: "create_worktree", name: "child-work", branch: "child-work", place: "project" }, target);
  expect((await ledger(f, target))?.trees ?? {}).toEqual({});
  const tree = (await ledger(f))?.trees["child-work"];
  expect(tree).toMatchObject({ conversation: child.conversationId, branch: { ref: "refs/heads/child-work" } });
  const path = tree?.path ?? "";
  await writeFile(join(path, "work.txt"), "w\n"); await git(path, ["add", "work.txt"]); await git(path, ["commit", "-qm", "Unmerged work"]);
  // The same reader the session wires in: Bash may delete the child's branch once its tree is gone.
  await git(f.repo, ["worktree", "remove", "--force", path]);
  await call(f, "bash", { command: "git branch -D child-work" }, target);
  expect(await gatedActions(f.journal.harness, f.journal.conversation.id, context)).toEqual([]);
  expect(await git(f.repo, ["branch", "--list", "child-work"])).toBe("");
});

it("gates a Bash delete of a branch that no scratch_git call made", async () => {
  const f = await fixture();
  await git(f.repo, ["switch", "-qc", "mine"]); await git(f.repo, ["commit", "-q", "--allow-empty", "-m", "Mine"]); await git(f.repo, ["switch", "-q", "main"]);
  await call(f, "bash", { command: "git branch -D mine" });
  expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context)).map(gate => gate.description)).toEqual(["Delete an unmerged Git branch"]);
  expect(await git(f.repo, ["branch", "--list", "mine"])).toContain("mine");
});
