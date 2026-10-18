#!/usr/bin/env node
// Acceptance through the shipped entry point. Never contact deployed units or profiles.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const execute = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
try {
  assert.equal(process.platform, "linux");
  await execute("systemctl", ["--user", "show-environment"], { timeout: 5000 });
} catch {
  console.error("UNVERIFIED: daemon restart acceptance requires Linux user-systemd.");
  process.exit(2);
}
const root = await mkdtemp(join(tmpdir(), "fg-daemon-restart-"));
const poll = async (read, description) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
};
const readOptional = path => readFile(path, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return ""; });
async function runCase(mode) {
  const directory = join(root, mode);
  const profile = join(directory, "profile");
  const socketPath = join(directory, "sessiond.sock");
  const unit = `fg-daemon-proof-${randomUUID()}.service`;
  let browser;
  let passed = false;
  const http = (path, body) => new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, timeout: 5000 }, response => {
      let text = "";
      response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) reject(new Error(`${path}: HTTP ${response.statusCode}: ${text}`));
        else { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } }
      });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error(`HTTP timeout: ${path}`)));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const ownerPid = async () => Number((await execute("systemctl", ["--user", "show", unit, "--property=MainPID", "--value"])).stdout.trim());
  try {
    await mkdir(join(profile, "extensions"), { recursive: true });
    await mkdir(join(directory, "data"));
    await symlink(join(repository, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(join(directory, "proof.txt"), "PROOF-READ-OK");
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1", retry: { enabled: false }, packages: [] }));
    await writeFile(join(directory, "config.json"), JSON.stringify({ agent: { command: "pi", dir: profile } }));
    await writeFile(join(profile, "extensions/restart-proof.ts"), `
      import { appendFile } from 'node:fs/promises';
      import { setTimeout as delay } from 'node:timers/promises';
      import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/providers/faux")))};
      import { Type } from 'typebox';
      export default function(pi) {
        const provider = fauxProvider({ tokensPerSecond: 100000 });
        const response = (context) => {
          const last = context.messages.at(-1);
          const task = context.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('DAEMON-RESTART-PROOF'));
          const call = (name, args, id) => fauxToolCall(name, args, { id });
          const calls = values => fauxAssistantMessage(values, { stopReason: 'toolUse' });
          if (!task) return fauxAssistantMessage('Restart acceptance');
          if (last?.role === 'user') return calls([call('proof_hold', {}, 'hold')]);
          const results = context.messages.filter(message => message.role === 'toolResult');
          if (!results.some(message => message.toolCallId === 'owner')) return calls([
            call('proof_owner', {}, 'owner'), call('read', { path: ${JSON.stringify(join(directory, "proof.txt"))} }, 'read'),
            call('bash', { command: 'printf PROOF-BASH-OK' }, 'bash')
          ]);
          return calls([call('end_turn', { awaiting: 'nothing', reply: 'DAEMON-RECOVERED' }, 'finish')]);
        };
        provider.setResponses(Array.from({ length: 100 }, () => response));
        pi.registerProvider(provider.provider);
        for (const name of ['proof_hold', 'proof_owner']) pi.registerTool({
          name, label: name, description: name, parameters: Type.Object({}),
          async execute(_id, _args, signal) {
            await appendFile(${JSON.stringify(join(directory, "calls.jsonl"))}, JSON.stringify({ name, pid: process.pid }) + '\\n');
            if (name === 'proof_hold') await delay(120000, undefined, { signal });
            return { content: [{ type: 'text', text: 'owner ' + process.pid }] };
          }
        });
      }
    `);
    const environment = {
      PATH: process.env.PATH, HOME: directory, XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "share"),
      PI_CODING_AGENT_DIR: profile, PI_WEB_DATA_DIR: join(directory, "data"), PI_WEB_CONFIG: join(directory, "config.json"),
      PI_WEB_SESSIOND_SOCKET: socketPath, PI_OFFLINE: "1",
    };
    await execute("systemd-run", ["--user", "--quiet", `--unit=${unit}`, "--property=Type=exec", "--property=KillMode=control-group", "--property=TimeoutStopSec=10s",
      `--property=WorkingDirectory=${directory}`, `--property=StandardOutput=append:${directory}/daemon.log`, "--property=StandardError=inherit",
      // env -i removes credentials and daemon settings inherited from the user manager too.
      "--", "env", "-i", ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), process.execPath, join(repository, "dist/server/sessiond.js")]);
    await poll(() => http("/health").catch(error => { if (error.code !== "ENOENT" && error.code !== "ECONNREFUSED") throw error; }), "daemon health");
    const session = await http("/sessions", { cwd: directory, modelSpec: "faux/faux-1" });
    assert.equal(typeof session.id, "string");
    const base = `/sessions/${session.id}`;
    const query = `cwd=${encodeURIComponent(directory)}`;
    browser = new WebSocket(`ws+unix://${socketPath}:${base}/events?${query}&native=1&open=1`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser attachment timed out")), 10000);
      browser.once("error", error => { clearTimeout(timer); reject(error); });
      browser.once("message", data => {
        clearTimeout(timer);
        try { assert.equal(JSON.parse(data.toString()).type, "session.open"); resolve(); }
        catch (error) { reject(error); }
      });
    });
    // Keep the browser attached through shutdown. An open socket must not block close.
    browser.on("error", () => {});
    await http(`${base}/prompt`, { cwd: directory, text: "DAEMON-RESTART-PROOF" });
    await poll(async () => (await readOptional(join(directory, "calls.jsonl"))).includes('"proof_hold"'), "active tool");
    const before = await ownerPid();
    const started = Date.now();
    if (mode === "graceful") {
      await execute("systemctl", ["--user", "restart", unit], { timeout: 20000 });
      assert.ok(Date.now() - started < 10000, "Graceful restart exceeded TimeoutStopSec=10s");
      const log = (await execute("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"])).stdout;
      assert.doesNotMatch(log, /timed out|Main process exited|Failed with result|shutdown operation failed/i);
      assert.match(log, /Stopped /);
    } else {
      await execute("systemctl", ["--user", "kill", "--signal=SIGKILL", "--kill-whom=all", unit]);
      await poll(async () => await ownerPid() === 0, "forced owner death");
      await execute("systemctl", ["--user", "start", unit]);
    }
    const after = await poll(async () => { const pid = await ownerPid(); return pid !== 0 && pid !== before ? pid : undefined; }, "new owner");
    // No prompt, open request, or websocket is sent to the new daemon before recovery completes.
    await poll(async () => {
      assert.notEqual(await ownerPid(), 0, `New daemon exited:\n${(await readFile(join(directory, "daemon.log"), "utf8")).slice(-5000)}`);
      return (await readOptional(join(directory, "calls.jsonl"))).includes('"proof_owner"');
    }, "startup recovery without input");
    const messages = await poll(async () => {
      const page = await http(`${base}/messages?${query}`);
      return JSON.stringify(page).includes("DAEMON-RECOVERED") ? page : undefined;
    }, "recovered end_turn");
    const text = JSON.stringify(messages);
    assert.match(text, /PROOF-READ-OK/); assert.match(text, /PROOF-BASH-OK/); assert.match(text, /interrupted/i);
    assert.doesNotMatch(text, /ownership lost|ELOCKED|flock exit/);
    const calls = (await readFile(join(directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [{ name: "proof_hold", pid: before }, { name: "proof_owner", pid: after }]);
    assert.doesNotMatch(await readFile(join(directory, "daemon.log"), "utf8"), /shutdown operation failed|ELOCKED|ownership lost|could not recover a durable session/);
    console.log(`PASS: production daemon ${mode} restart; attached browser, startup recovery, and tools under owner ${after}.`);
    passed = true;
  } finally {
    browser?.terminate();
    await execute("systemctl", ["--user", "stop", unit], { timeout: 20000 }).catch(error => { passed = false; console.error(error); });
    await execute("journalctl", ["--user", "-u", unit, "--no-pager"]).then(result => writeFile(join(directory, "supervisor.log"), result.stdout)).catch(error => { passed = false; console.error(error); });
    await execute("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
    if (!passed) console.error(`Retained ${mode} logs: ${directory}/daemon.log and ${directory}/supervisor.log`);
  }
  assert.ok(passed, `${mode} acceptance or cleanup failed`);
}
let passed = true;
for (const mode of ["graceful", "forced"]) {
  try { await runCase(mode); }
  catch (error) { passed = false; console.error(`${mode} acceptance failed:`, error); }
}
if (passed) await rm(root, { recursive: true, force: true });
else process.exitCode = 1;
