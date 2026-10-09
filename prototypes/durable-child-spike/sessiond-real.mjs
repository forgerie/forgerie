#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Real-model acceptance against an isolated production sessiond, never the installed units.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = await mkdtemp(join(tmpdir(), "forgerie-child-real-"));
const agentDir = join(output, "agent");
const cwd = join(output, "workspace");
const dataDir = join(output, "data");
const port = Number(process.env.CHILD_ACCEPTANCE_PORT ?? "18564");
const model = process.env.CHILD_ACCEPTANCE_MODEL ?? "deepseek-v4.1-flash";
const provider = "child-acceptance";
const origin = `http://127.0.0.1:${port}`;
const results = [];
let daemon;
let starts = 0;
const proxy = JSON.parse(await readFile(process.env.CHILD_ACCEPTANCE_PROXY ?? join(process.env.HOME, ".local/share/forgerie/agent/cliproxyapi.json"), "utf8"));
await mkdir(join(agentDir, "agents"), { recursive: true });
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
await copyFile(join(repo, "prototypes/durable-child-spike/work-window.mjs"), join(cwd, "work-window.mjs"));
await chmod(join(cwd, "work-window.mjs"), 0o755);
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { [provider]: {
  baseUrl: `${proxy.baseUrl.replace(/\/+$/, "")}/v1`, api: "openai-completions", apiKey: proxy.apiKey,
  models: [{ id: model, name: model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
} } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: provider, defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
await writeFile(join(agentDir, "agents", "acceptance-writer.md"), `---\nname: acceptance-writer\ndescription: Child acceptance worker\nmodel: ${provider}/${model}\ntools: read, write, bash\ninheritProjectContext: false\n---\nDo exactly the task. Use the supplied tools. Use ask_human when asked to ask a question. Obey user steers. Do not delegate. Finish with the specified marker.\n`);
const configPath = join(output, "config.json");
await writeFile(configPath, JSON.stringify({ agent: { command: "pi", dir: agentDir }, durableChildren: true, codemode: false, spawnSessions: false, subsessions: false }));

async function request(path, body) {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
async function until(label, check, timeout = 180000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await sleep(150);
  }
}
async function startDaemon() {
  const log = createWriteStream(join(output, `sessiond-${++starts}.log`));
  // Remove any inherited profile/session/config selection. The harness owns every persisted path.
  const env = { ...process.env, PI_WEB_CONFIG: configPath, PI_WEB_DATA_DIR: dataDir, PI_WEB_SESSIOND_PORT: String(port), PI_WEB_SESSIOND_HOST: "127.0.0.1", PI_WEB_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir, PI_WEB_OFFLINE: "1" };
  delete env.PI_WEB_AGENT_SESSION_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  daemon = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(repo, "src/server/sessiond.ts")], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  daemon.stdout.pipe(log);
  daemon.stderr.pipe(log);
  const current = daemon;
  await until("isolated daemon ready", async () => {
    if (current.exitCode !== null || current.signalCode !== null) throw new Error(`Daemon exited; see ${output}`);
    let runtime;
    try { runtime = await request("/runtime"); } catch { return false; }
    assert.equal(runtime.activeAgentProfile?.dir, agentDir, "Acceptance port belongs to a different daemon; refusing to use it");
    return true;
  }, 60000);
  console.log(`READY pid=${daemon.pid} evidence=${output}`);
}
async function stopDaemon(signal = "SIGTERM") {
  if (daemon === undefined || daemon.exitCode !== null || daemon.signalCode !== null) return;
  const current = daemon;
  const exited = new Promise((done) => current.once("exit", done));
  current.kill(signal);
  await exited;
}
const query = `?cwd=${encodeURIComponent(cwd)}`;
const text = (message) => typeof message.content === "string" ? message.content : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
const children = (id) => request(`/sessions/${id}/children${query}`);
const transcript = async (id) => (await request(`/sessions/${id}/messages${query}&limit=500`)).messages;
async function save(id, label) {
  const parent = await transcript(id);
  const listed = await children(id);
  const childViews = await Promise.all(listed.map(async (child) => ({ ...child, transcript: await request(`/sessions/${id}/children/${child.conversationId}/messages${query}`) })));
  await writeFile(join(output, `${label}.json`), `${JSON.stringify({ id, cwd, parent, children: childViews }, null, 2)}\n`);
  return parent;
}
async function launch(name, task) {
  const session = await request("/sessions", { cwd, modelSpec: `${provider}/${model}`, thinkingLevel: "off", destination: { kind: "existing-workspace" } });
  const id = session.id;
  await request(`/sessions/${id}/prompt`, { cwd, text: `Use child_agent action spawn once: name "${name}", agent "acceptance-writer", message ${JSON.stringify(task)}. Do not perform the child's work yourself. After spawning, acknowledge and end your reply. When its report arrives, acknowledge only, never send it further tasks.` });
  const child = await until(`spawn ${name}`, async () => (await children(id)).find((item) => item.name === name));
  assert.equal(child.agent, "acceptance-writer");
  return { id, child };
}
async function reported(id, name) {
  return until(`report ${name}`, async () => {
    const reports = (await transcript(id)).filter((message) => message.role === "user" && text(message).startsWith(`[subagent ${name} answered`));
    assert.ok(reports.length <= 1, `duplicate report for ${name}`);
    return reports.length === 1 && reports[0];
  });
}
async function exists(file) {
  try { return await readFile(join(cwd, file), "utf8"); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function passed(label, evidence) {
  const view = JSON.parse(await readFile(join(output, evidence.transcript), "utf8"));
  evidence.sessionId = view.id;
  evidence.parentEntries = view.parent.filter((message) => message.customType?.startsWith("forgerie.child-") || (message.role === "user" && text(message).startsWith("[subagent")))
    .map((message) => ({ kind: message.customType ?? message.role, text: text(message) }));
  evidence.children = view.children.map((child) => ({ name: child.name, agent: child.agent, conversationId: child.conversationId, busy: child.busy,
    entries: child.transcript.messages.filter((message) => message.role !== "user").map((message) => ({ role: message.role,
      ...(message.toolName === undefined ? {} : { toolName: message.toolName }), text: text(message),
      calls: typeof message.content === "string" ? [] : (message.content ?? []).filter((part) => part.type === "toolCall").map((call) => ({ name: call.name, arguments: call.arguments })),
    })),
  }));
  results.push({ label, pass: true, evidence });
  await writeFile(join(output, "results.json"), `${JSON.stringify({ runAt: new Date().toISOString().slice(0, 10), model: `${provider}/${model}`, results }, null, 2)}\n`);
  console.log(`PASS ${label}`);
}
try {
  await startDaemon();
  const writer = await launch("writer", 'Use write to create written.txt with exactly "CHILD-WRITE-OK". Reply WRITE-DONE.');
  await reported(writer.id, "writer");
  assert.equal(await exists("written.txt"), "CHILD-WRITE-OK");
  await save(writer.id, "write");
  await passed("agent file and coding write", { file: "written.txt", content: "CHILD-WRITE-OK", transcript: "write.json" });

  const steerer = await launch("steerer", 'Use bash to execute ./work-window.mjs steer-ready.txt 5. After this tool ends, read steer-ready.txt, then write original.txt with OLD. Reply ORIGINAL-DONE.');
  await until("steer window", () => exists("steer-ready.txt"));
  await request(`/sessions/${steerer.id}/children/${steerer.child.conversationId}/message`, { cwd, text: 'Change of task: do not write original.txt. Instead use write to create steered.txt with exactly "STEER-OK". Reply STEER-DONE.' });
  const steerReport = await reported(steerer.id, "steerer");
  assert.equal(await exists("steered.txt"), "STEER-OK");
  assert.equal(await exists("original.txt"), false);
  assert.match(text(steerReport), /STEER-DONE/);
  const steerParent = await save(steerer.id, "steer");
  assert.ok(steerParent.some((message) => message.customType === "forgerie.child-note"));
  await passed("user steer", { file: "steered.txt", transcript: "steer.json" });

  const stopper = await launch("stopper", 'Use bash to execute ./work-window.mjs stop-ready.txt 30. Afterwards use write to create must-not-exist.txt with BAD. Reply STOP-TASK-DONE.');
  await until("stop window", () => exists("stop-ready.txt"));
  await request(`/sessions/${stopper.id}/children/${stopper.child.conversationId}/stop`, { cwd });
  await until("child stopped", async () => !(await children(stopper.id)).find((item) => item.name === "stopper").busy);
  assert.equal(await exists("must-not-exist.txt"), false);
  const stoppedParent = await save(stopper.id, "stop");
  assert.ok(stoppedParent.some((message) => message.customType === "forgerie.child-note"));
  assert.equal(stoppedParent.filter((message) => message.role === "user" && text(message).startsWith("[subagent stopper")).length, 0);
  await passed("stop", { forbiddenFileAbsent: true, transcript: "stop.json" });

  const asker = await launch("asker", 'Call ask_human with the exact question "Which acceptance colour?". After the user answers, write answer.txt with exactly that answer. Reply QUESTION-DONE.');
  const question = await until("question", async () => (await children(asker.id)).find((item) => item.name === "asker").questions[0]);
  await until("parent idle", async () => !(await request(`/sessions/${asker.id}/status${query}`)).isStreaming);
  const answersBefore = (await transcript(asker.id)).filter((message) => message.role === "assistant").length;
  await sleep(1000);
  assert.equal((await transcript(asker.id)).filter((message) => message.role === "assistant").length, answersBefore);
  await request(`/sessions/${asker.id}/children/questions/answer`, { cwd, questionId: question.questionId, answer: "TEAL-OK" });
  await reported(asker.id, "asker");
  assert.equal(await exists("answer.txt"), "TEAL-OK");
  await save(asker.id, "question");
  await passed("question and answer without a question-triggered parent turn", { answersBefore, transcript: "question.json" });

  const runner = await launch("runner", 'Use bash exactly once to execute ./work-window.mjs crash-started.txt 30. If the tool is interrupted by a restart, do not rerun it. Continue by using write to create resumed.txt with exactly "RESUME-OK". Otherwise also create resumed.txt with that content. Reply RESUME-DONE.');
  await until("crash window", () => exists("crash-started.txt"));
  await until("live index persisted", async () => {
    try { return JSON.parse(await readFile(join(dataDir, "durable-children-live.json"), "utf8")).some((ref) => ref.id === runner.id); } catch { return false; }
  });
  await save(runner.id, "before-kill");
  await stopDaemon("SIGKILL");
  await startDaemon();
  // Check file effects first. A per-session GET would itself reopen the parent and conceal a startup-resume defect.
  await until("startup resumes without opening parent", () => exists("resumed.txt"));
  assert.equal(await exists("resumed.txt"), "RESUME-OK");
  assert.equal(await exists("crash-started.txt"), "ready\n");
  await reported(runner.id, "runner");
  assert.equal((await children(runner.id)).length, 1);
  assert.equal((await children(runner.id))[0].conversationId, runner.child.conversationId);
  await save(runner.id, "after-kill");
  await passed("SIGKILL and automatic startup resume", { conversationId: runner.child.conversationId, transcript: "after-kill.json", file: "resumed.txt" });
  await copyFile(join(output, "results.json"), join(repo, "prototypes/durable-child-spike/sessiond-real-results.json"));
  console.log(`ACCEPTANCE PASSED ${output}`);
} catch (error) {
  await writeFile(join(output, "failure.txt"), `${error.stack ?? error}\n`);
  console.error(`ACCEPTANCE FAILED ${output}`, error);
  process.exitCode = 1;
} finally {
  await stopDaemon();
  // Evidence stays on disk, but the isolated provider file must not retain a copied credential.
  const providerFile = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
  providerFile.providers[provider].apiKey = "REDACTED";
  await writeFile(join(agentDir, "models.json"), JSON.stringify(providerFile), { mode: 0o600 });
}
