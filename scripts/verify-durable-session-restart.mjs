#!/usr/bin/env node
// Only uniquely named proof units and scratch profiles are used. No live daemon is contacted.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const owner = process.argv[2] === "--owner";
if (!owner) {
  try {
    assert.equal(process.platform, "linux");
    await execute("systemctl", ["--user", "show-environment"], { timeout: 5000 });
  } catch {
    console.log("SKIP: Durable restart proof requires Linux user-systemd.");
    process.exit(0);
  }
}
const root = owner ? process.argv[3] : await mkdtemp(join(tmpdir(), "fg-durable-restart-"));
// Never load the running profile or inherited provider credentials.
const allowed = new Set(["PATH", "HOME", "USER", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG"]);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = join(root, "profile");
process.env.PI_WEB_DATA_DIR = join(root, "data");
process.env.PI_WEB_CONFIG = join(root, "unused-config.json");

if (owner) {
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai/providers/faux");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { createRegistry, defineExtension, defineTool } = await import("@earendil-works/pi-durable");
  const { Type } = await import("typebox");
  const { DurableSessionJournal } = await import("../dist/server/sessions/durableSessionJournal.js");
  const { recoverDurableSessions } = await import("../dist/server/sessions/durableSessionRecovery.js");
  await mkdir(join(root, "profile"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  const saved = await readFile(join(root, "session.json"), "utf8").then(JSON.parse).catch(error => { if (error.code !== "ENOENT") throw error; });
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses(saved ? [fauxAssistantMessage("Recovered without a prompt.")] : [
    fauxAssistantMessage([fauxToolCall("safe_read", {}, { id: "safe" }), fauxToolCall("unsafe_command", {}, { id: "unsafe" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Completed."),
  ]);
  let journal;
  const tools = defineExtension({ name: "restart-proof", tools: ["safe_read", "unsafe_command"].map(name => defineTool({
    name, description: name, parameters: Type.Object({}), replay: name === "safe_read" ? "safe" : "unsafe",
    execute: async (_args, _api, ctx) => {
      journal.assertOwned();
      await appendFile(join(root, "calls.jsonl"), JSON.stringify({ name, pid: process.pid }) + "\n");
      if (!saved) await delay(120000, undefined, { signal: ctx.abortSignal });
      journal.assertOwned();
      return { content: [{ type: "text", text: `owner ${process.pid}` }] };
    },
  })) });
  const registry = createRegistry(); registry.install(tools);
  const manager = saved ? SessionManager.open(saved.path) : SessionManager.create(root, join(root, "data/sessions"));
  if (!saved) manager.appendMessage(fauxAssistantMessage("Proof context."));
  const open = async () => {
    journal = await DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [tools] }, onReport: error => console.error(error) });
  };
  process.once("SIGTERM", () => {
    console.log("shutdown", process.pid);
    void (async () => {
      try {
        await journal?.close();
        await writeFile(join(root, `shutdown-${process.pid}.json`), JSON.stringify({ ok: true }));
        process.exit(0);
      } catch (error) {
        console.error(error);
        await writeFile(join(root, `shutdown-${process.pid}.json`), JSON.stringify({ ok: false, error: String(error) }));
        process.exit(1);
      }
    })();
  });
  if (saved) {
    const report = await recoverDurableSessions({ catalog: async () => [saved], available: async () => true, stopped: () => false, reopen: open });
    console.log("recovery", report);
    assert.deepEqual(report, { resumed: [saved.id], failed: [] });
    journal.harness.resume();
    await journal.conversation.waitForIdle(context);
    journal.assertOwned();
    const entries = await journal.conversation.entries({ order: "ascending" }, 100, undefined, context);
    const results = entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    assert.ok(results.some(result => result.toolCallId === "safe" && !result.isError));
    assert.ok(results.some(result => result.toolCallId === "unsafe" && result.isError && JSON.stringify(result).includes("interrupted")));
    await writeFile(join(root, "recovered.json"), JSON.stringify({ pid: process.pid, results }));
  } else {
    await open();
    await writeFile(join(root, "session.json"), JSON.stringify({ id: manager.getSessionId(), cwd: root, path: manager.getSessionFile() }));
    await journal.conversation.submit({ type: "input", content: "Run both proof tools." }, context);
  }
  setInterval(() => {}, 1000);
} else {
  const unit = `fg-durable-proof-${randomUUID()}.service`;
  let passed = false;
  const poll = async (read, description) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await read();
      if (result) return result;
      await delay(100);
    }
    throw new Error(`Timed out: ${description}. Inspect ${root}`);
  };
  const calls = () => readFile(join(root, "calls.jsonl"), "utf8").then(text => text.trim().split("\n").map(JSON.parse)).catch(error => { if (error.code !== "ENOENT") throw error; return []; });
  try {
    await execute("systemd-run", ["--user", "--quiet", `--unit=${unit}`, "--property=Type=exec", "--property=KillMode=control-group", "--property=TimeoutStopSec=10s",
      `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${root}`, `--property=StandardOutput=append:${root}/owner.log`, "--property=StandardError=inherit",
      "--", process.execPath, fileURLToPath(import.meta.url), "--owner", root]);
    const before = await poll(async () => { const rows = await calls(); return rows.length === 2 ? rows : undefined; }, "tools in flight");
    assert.equal(before[0].pid, before[1].pid);
    await execute("systemctl", ["--user", "restart", unit]);
    const shutdown = JSON.parse(await readFile(join(root, `shutdown-${before[0].pid}.json`), "utf8"));
    assert.equal(shutdown.ok, true, `Shutdown failed: ${JSON.stringify(shutdown)}`);
    const recovered = await poll(() => readFile(join(root, "recovered.json"), "utf8").then(JSON.parse).catch(error => { if (error.code !== "ENOENT") throw error; }), "startup recovery without input");
    assert.notEqual(recovered.pid, before[0].pid);
    assert.deepEqual(await calls(), [...before, { name: "safe_read", pid: recovered.pid }]);
    console.log(`PASS: safe call resumed under owner ${recovered.pid}; unsafe call ran once and reports interruption.`);
    passed = true;
  } finally {
    await execute("systemctl", ["--user", "stop", unit]).catch(error => { console.error("Proof unit cleanup failed", error); passed = false; process.exitCode = 1; });
    await execute("journalctl", ["--user", "-u", unit, "--no-pager"]).then(result => writeFile(join(root, "supervisor.log"), result.stdout)).catch(() => {});
    await execute("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error(`Retained shutdown/recovery logs: ${root}/owner.log and ${root}/supervisor.log`);
  }
}
