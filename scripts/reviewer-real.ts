#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#git -c npx tsx
// Opt-in acceptance: a real model, as a Durable reviewer child, reviews a committed branch without asking for diffs.
// REVIEWER_REAL=1 ./scripts/reviewer-real.ts            Forgerie's agents first, as sessiond runs them.
// REVIEWER_AGENTS=bundled ...                           pi-subagents' reviewer only, to reproduce the old failure.
// Owns only a temporary profile and Git repository. Model calls cost money.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "../src/server/sessions/durableChildHost.js";
import { bundledSubagentsPackagePath } from "../src/server/sessions/bundledSubagents.js";
import { bundledForgerieAgentsPath } from "../src/server/sessions/bundledForgerieSkills.js";
import { sanitizedGitEnv } from "../src/server/git/gitEnv.js";

if (process.env.REVIEWER_REAL !== "1") throw new Error("Set REVIEWER_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const parentModel = process.env.PARENT_MODEL ?? "deepseek-v4.1-flash";
const reviewerModel = process.env.REVIEWER_MODEL ?? "gpt-6.1-sol";
const bundledOnly = process.env.REVIEWER_AGENTS === "bundled";
const root = await mkdtemp(join(tmpdir(), "forgerie-reviewer-real-"));
const agentDir = join(root, "agent");
const repo = join(root, "repo");
await mkdir(agentDir, { mode: 0o700 }); await mkdir(repo);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const model = (id: string) => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 });
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "reviewer-acceptance": {
  baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions",
  models: [model(parentModel), model(reviewerModel)],
} } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "reviewer-acceptance", defaultModel: parentModel, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));

const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env: sanitizedGitEnv(), encoding: "utf8" });
git("init", "-q", "-b", "main"); git("config", "user.email", "acceptance@example.invalid"); git("config", "user.name", "Acceptance");
await writeFile(join(repo, "total.js"), "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n");
git("add", "."); git("commit", "-qm", "Add total");
git("switch", "-qc", "feature");
// The planted bug: the discount is applied to the price twice.
await writeFile(join(repo, "total.js"), "export function total(items, discount = 0) {\n  return items.reduce((sum, item) => sum + item.price * (1 - discount) * (1 - discount), 0);\n}\n");
git("commit", "-qam", "Apply a discount to the total");
git("switch", "-q", "main");

const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const service = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "live.json")),
    builtinAgentsDirs: [...(bundledOnly ? [] : [bundledForgerieAgentsPath()]), join(bundledSubagentsPackagePath(), "agents")] }),
});
try {
  const ref = { id: (await service.start(repo)).id, cwd: repo };
  const task = `Review the branch feature against main in the repository ${repo}. It adds a discount to total(). Use \`git -C ${repo} diff main...feature\`. Read only: do not edit, commit, or merge anything. If you can, merge feature into a scratch worktree of your own under /tmp and run \`node --check total.js\` there; remove the scratch worktree when you finish. Report must-fix findings with file and line, or say there are none.`;
  await service.prompt(ref, `Call child_agent once with action spawn, name review, agent reviewer, model reviewer-acceptance/${reviewerModel}, and this exact message:\n\n${task}\n\nThen reply only "Waiting." and stop.`);
  const deadline = Date.now() + 600_000;
  let outcome: { kind: "report"; text: string } | { kind: "question"; text: string } | undefined;
  while (outcome === undefined) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the reviewer");
    const child = (await service.durableChildren(ref)).find((candidate) => candidate.name === "review");
    const question = child?.questions[0];
    if (question !== undefined) outcome = { kind: "question", text: question.question };
    const messages = (await service.messages(ref, { limit: 200 })).messages as { role?: string; content?: unknown }[];
    const report = messages.find((message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith("[subagent review"));
    if (report !== undefined && typeof report.content === "string") outcome = { kind: "report", text: report.content };
    await sleep(1000);
  }
  const child = (await service.durableChildren(ref)).find((candidate) => candidate.name === "review");
  if (child === undefined) throw new Error("No reviewer child");
  const transcript = await service.durableChildMessages(ref, child.conversationId);
  const calls = transcript.messages.flatMap((message) => message.role === "assistant" ? message.content.flatMap((part) => part.type === "toolCall" ? [`${part.name} ${JSON.stringify(part.arguments)}`] : []) : []);
  const summary = { agents: bundledOnly ? "pi-subagents only" : "Forgerie first", parentModel, reviewerModel, outcome: outcome.kind, calls, text: outcome.text.slice(0, 1500) };
  await writeFile(join(root, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(outcome.kind, "report", "The reviewer asked the user instead of reviewing");
  assert.ok(calls.some((call) => /^watchdog_diff .*"range"/u.test(call) || /^bash .*git .*diff/u.test(call)), "The reviewer did not read the committed range");
  assert.match(outcome.text, /discount/iu);
  console.log(`PASS ${root}`);
} finally {
  await service.dispose();
  await rm(join(agentDir, "models.json"), { force: true });
}
