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
/**
 * graceful and forced restart with an in-process tool in flight.
 * continuation and slow-stop copy the deployed sessiond unit (Restart=always,
 * RestartSec=3s, KillMode=control-group) and the publisher's stop, then start.
 * Both are expected red until the ownership defect is fixed; see docs/testing.md.
 */
const CASES = {
  graceful: { hold: "proof_hold", timeoutStop: "10s" },
  forced: { hold: "proof_hold", timeoutStop: "10s" },
  // The first call is a bash command, which systemd's SIGTERM reaches directly.
  // The next model step calls another tool, which must run under the new owner.
  continuation: { hold: "bash", timeoutStop: "20s", production: true },
  // The in-flight tool ignores abort, so the graceful stop outlasts TimeoutStopSec
  // and systemd sends SIGKILL. The start follows at once.
  "slow-stop": { hold: "proof_hold_stubborn", timeoutStop: "3s", production: true },
};
async function runCase(mode) {
  const settings = CASES[mode];
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
  const unitState = async () => Object.fromEntries((await execute("systemctl", ["--user", "show", unit, "--property=Result,NRestarts"])).stdout.trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const holdCommand = `printf '%s\\n' '{"name":"bash_hold"}' >> ${JSON.stringify(join(directory, "calls.jsonl"))}; exec sleep 120`;
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
          const hold = ${JSON.stringify(settings.hold)};
          if (last?.role === 'user') return calls([hold === 'bash' ? call('bash', { command: ${JSON.stringify(holdCommand)} }, 'hold') : call(hold, {}, 'hold')]);
          const results = context.messages.filter(message => message.role === 'toolResult');
          if (!results.some(message => message.toolCallId === 'owner')) return calls(${settings.production === true ? "[call('proof_owner', {}, 'owner'), call('bash', { command: 'printf PROOF-BASH-OK' }, 'bash')]" : `[
            call('proof_owner', {}, 'owner'), call('read', { path: ${JSON.stringify(join(directory, "proof.txt"))} }, 'read'),
            call('bash', { command: 'printf PROOF-BASH-OK' }, 'bash')
          ]`});
          return calls([call('end_turn', { awaiting: 'nothing', reply: 'DAEMON-RECOVERED' }, 'finish')]);
        };
        provider.setResponses(Array.from({ length: 100 }, () => response));
        pi.registerProvider(provider.provider);
        for (const name of ['proof_hold', 'proof_hold_stubborn', 'proof_owner']) pi.registerTool({
          name, label: name, description: name, parameters: Type.Object({}),
          async execute(_id, _args, signal) {
            await appendFile(${JSON.stringify(join(directory, "calls.jsonl"))}, JSON.stringify({ name, pid: process.pid }) + '\\n');
            if (name === 'proof_hold') await delay(120000, undefined, { signal });
            // A tool that ignores abort, like a long command that ignores SIGTERM.
            if (name === 'proof_hold_stubborn') await delay(120000);
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
    const launch = () => execute("systemd-run", ["--user", "--quiet", `--unit=${unit}`, "--property=Type=exec", "--property=KillMode=control-group", `--property=TimeoutStopSec=${settings.timeoutStop}`,
      ...(settings.production === true ? ["--property=Restart=always", "--property=RestartSec=3s"] : []),
      `--property=WorkingDirectory=${directory}`, `--property=StandardOutput=append:${directory}/daemon.log`, "--property=StandardError=inherit",
      // env -i removes credentials and daemon settings inherited from the user manager too.
      "--", "env", "-i", ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), process.execPath, join(repository, "dist/server/sessiond.js")]);
    await launch();
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
    const holdName = settings.hold === "bash" ? "bash_hold" : settings.hold;
    await poll(async () => (await readOptional(join(directory, "calls.jsonl"))).includes(`"${holdName}"`), "active tool");
    const before = await ownerPid();
    const started = Date.now();
    if (settings.production === true) {
      // The publisher's order: stop, confirm, then start.
      await execute("systemctl", ["--user", "stop", unit], { timeout: 60000 });
      const stopped = await unitState();
      if (mode === "slow-stop") assert.equal(stopped.Result, "timeout", `Precondition: the stop must outlast TimeoutStopSec=${settings.timeoutStop}; got Result=${stopped.Result}`);
      // systemd unloads a stopped transient unit, so the start launches the same unit again.
      // The deployed units are persistent and use systemctl start; both run a new owner at once.
      await execute("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
      await poll(async () => (await execute("systemctl", ["--user", "show", unit, "--property=LoadState", "--value"])).stdout.trim() === "not-found", "stopped proof unit unloaded");
      await launch();
    } else if (mode === "graceful") {
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
    if (settings.production === true) {
      // The health read is not input: it neither prompts nor opens the session.
      await poll(() => http("/health").catch(error => { if (error.code !== "ENOENT" && error.code !== "ECONNREFUSED") throw error; }), "new daemon health");
      const early = (await readFile(join(directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse).find(call => call.name === "proof_owner" && call.pid !== after);
      if (early !== undefined) {
        const lost = /[^"\\]*ownership lost[^"\\]*/i.exec(JSON.stringify(await http(`${base}/messages?${query}`)))?.[0];
        assert.fail(`The next model step's tool calls ran under the stopping owner ${early.pid}, not the new owner ${after}${lost === undefined ? "" : `; transcript: ${lost}`}`);
      }
    }
    const messages = await poll(async () => {
      const page = await http(`${base}/messages?${query}`);
      return JSON.stringify(page).includes("DAEMON-RECOVERED") ? page : undefined;
    }, "recovered end_turn");
    const text = JSON.stringify(messages);
    assert.doesNotMatch(text, /ownership lost|ELOCKED|flock exit/);
    const calls = (await readFile(join(directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    if (settings.production === true) {
      // The second call ran once, under the new owner, and succeeded.
      assert.deepEqual(calls, [settings.hold === "bash" ? { name: "bash_hold" } : { name: settings.hold, pid: before }, { name: "proof_owner", pid: after }]);
      assert.match(text, new RegExp(`owner ${after}`)); assert.match(text, /PROOF-BASH-OK/);
      const state = await unitState();
      assert.equal(state.NRestarts, "0", `The new owner restarted ${state.NRestarts} time(s):\n${(await readFile(join(directory, "daemon.log"), "utf8")).slice(-5000)}`);
    } else {
      assert.match(text, /PROOF-READ-OK/); assert.match(text, /PROOF-BASH-OK/); assert.match(text, /interrupted/i);
      assert.deepEqual(calls, [{ name: "proof_hold", pid: before }, { name: "proof_owner", pid: after }]);
    }
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
// `--daemon [CASE ...]` runs the named cases; the default runs all of them.
const requested = process.argv.slice(3);
for (const mode of requested) if (!(mode in CASES)) { console.error(`Unknown case ${mode}; expected ${Object.keys(CASES).join(", ")}`); process.exit(2); }
let passed = true;
for (const mode of requested.length > 0 ? requested : Object.keys(CASES)) {
  try { await runCase(mode); }
  catch (error) { passed = false; console.error(`${mode} acceptance failed:`, error); }
}
if (passed) await rm(root, { recursive: true, force: true });
else process.exitCode = 1;
