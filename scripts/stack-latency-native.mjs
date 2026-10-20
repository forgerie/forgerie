#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node --import tsx
// Production daemon and edge, real temporary native journals. No live credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, symlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { nativeFixtureOptions, fixtureEnvironment } from "./stack-latency-native-options.mjs";
import { acquireHeavySlot } from "./lib/heavy-slot.mjs";

const options = nativeFixtureOptions(process.argv.slice(2));
const { root, port, clientDist, turns } = options;
await readFile(join(clientDist, "index.html"));
// Fail before seeding if another owner holds the port. Never stop that owner.
const occupied = await new Promise(resolve => {
  const socket = connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});
assert.equal(occupied, false, `Port ${port} is already in use`);
// mkdir without recursive deliberately rejects an existing/live profile.
await mkdir(root, { mode: 0o700 });
const environment = fixtureEnvironment(root);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
process.chdir(root);
for (const directory of ["profile/extensions", "data", "project"]) await mkdir(join(root, directory), { recursive: true });
const cwd = join(root, "project");
await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
await writeFile(join(root, "config.json"), JSON.stringify({ agent: { command: "pi", dir: environment.PI_CODING_AGENT_DIR } }));
await writeFile(join(root, "profile/settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1", retry: { enabled: false }, packages: [] }));
const providerPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/providers/faux"));
await writeFile(join(root, "profile/extensions/latency.ts"), `
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(providerPath)};
export default function(pi) {
  const provider = fauxProvider({ tokensPerSecond: 30 });
  provider.setResponses(Array.from({length: 10000}, () => () => fauxAssistantMessage([
    fauxToolCall('end_turn', { awaiting: 'nothing', reply: 'Controlled native provider completion. No external model was contacted.' }, { id: 'latency-finish' })
  ], { stopReason: 'toolUse' })));
  pi.registerProvider(provider.provider);
}
`);
const slot = await acquireHeavySlot(2);
try {
const [{ SessionManager }, { createModels }, { createRegistry }, { fauxProvider, fauxAssistantMessage }, { DurableSessionJournal }, { fixtureMessages }, { buildApp }, { SessionDaemonClient }] = await Promise.all([
  import("@earendil-works/pi-coding-agent"), import("@earendil-works/pi-ai/models"), import("@earendil-works/pi-durable"), import("@earendil-works/pi-ai/providers/faux"),
  import("../src/server/sessions/durableSessionJournal.ts"), import("../ui/scripts/fixtures/fast-chat-open.mjs"), import("../src/server/app.ts"), import("../src/sessiond/sessionDaemonClient.ts"),
]);
const { createDurableParentInitializer } = await import("../src/server/sessions/durableSdkSessionView.ts");
const sessions = [];
for (const [index, count] of turns.entries()) {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const marker = `Native destination ${index + 1} has exactly ${count} complete deterministic turns and its own distinct reply marker.`;
  const manager = SessionManager.create(cwd, undefined, { id });
  manager.appendModelChange("faux", "faux-1");
  manager.appendSessionInfo(`Native latency ${index + 1} (${count} turns)`);
  const messages = fixtureMessages(count);
  for (const { id: _presentation, ...message } of messages) manager.appendMessage(message.role === "assistant" ? { ...fauxAssistantMessage(message.content), ...message } : message);
  manager.appendMessage(fauxAssistantMessage(marker));
  const models = createModels(); models.setProvider(fauxProvider().provider);
  const journal = await DurableSessionJournal.open({ manager, models, registry: createRegistry(), agent: { model: { provider: "faux", modelId: "faux-1" } }, initializeParentDocuments: createDurableParentInitializer(manager) });
  try { journal.assertOwned(); } finally { await journal.close(); }
  sessions.push({ id, cwd, turns: count, messages: messages.length + 1, marker });
}
let daemon;
let stopping = false;
let restarting = false;
let app;
const log = await open(join(root, "daemon.log"), "a", 0o600);
const client = new SessionDaemonClient({ requestTimeoutMs: 10000 });
const startDaemon = async () => {
  daemon = spawn(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), fileURLToPath(new URL("../src/server/sessiond.ts", import.meta.url))], { env: environment, cwd, stdio: ["ignore", log.fd, log.fd] });
  daemon.once("exit", code => { if (!stopping && !restarting) { console.error(`Fixture daemon exited unexpectedly: ${code}`); process.exitCode = 1; void stop(); } });
  daemon.once("error", error => { console.error(error); process.exitCode = 1; void stop(); });
  const deadline = Date.now() + 60000;
  for (;;) {
    if (daemon.exitCode !== null) throw new Error("Fixture daemon exited; inspect its private daemon.log");
    try { const health = await client.request("GET", "/health"); if (health.statusCode === 200) break; }
    catch (error) { if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error; }
    assert.ok(Date.now() < deadline, "Fixture daemon readiness deadline"); await delay(100);
  }
  // Production native admission requires an active owner. The read-only command
  // catalog acquires that owner without sending a prompt or changing a model.
  for (const session of sessions) {
    const response = await client.request("GET", `/sessions/${session.id}/commands?${new URLSearchParams({ cwd })}`);
    assert.equal(response.statusCode, 200, `Controlled runtime acquisition failed: ${response.body}`);
  }
};
const stopDaemon = async () => {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  const exited = once(daemon, "exit");
  daemon.kill("SIGTERM");
  const timer = setTimeout(() => { process.exitCode = 1; daemon.kill("SIGKILL"); }, 15000);
  try { await exited; } finally { clearTimeout(timer); }
};
async function stop() {
  if (stopping) return;
  stopping = true;
  await app?.close(); await stopDaemon(); await log.close();
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
try {
  await startDaemon();
  app = await buildApp({ clientDist, sessionDaemon: client, logger: false });
  const token = randomUUID();
  app.post("/__fixtures/restart-daemon", async (request, reply) => {
    if (request.headers["x-fixture-token"] !== token) return reply.code(403).send({ error: "Fixture control token required" });
    if (restarting) return reply.code(409).send({ error: "Restart in progress" });
    restarting = true;
    try { await stopDaemon(); await startDaemon(); return { restarted: true }; }
    finally { restarting = false; }
  });
  app.get("/__fixtures/metrics", async () => ({ pid: process.pid, daemonPid: daemon.pid, memory: process.memoryUsage(), sessions: sessions.length }));
  await app.listen({ port, host: "127.0.0.1" });
  for (const session of sessions) {
    const response = await client.request("GET", `/sessions/${session.id}/open?${new URLSearchParams({ cwd, limit: "50" })}`);
    assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).readPath, "native", "Never present classic data as native");
  }
  await writeFile(join(root, "fixture.json"), JSON.stringify({ version: 1, origin: `http://127.0.0.1:${port}`, token, sessions, pid: process.pid, daemonPid: daemon.pid }, null, 2), { mode: 0o600 });
  console.log(`NATIVE_FIXTURE_READY ${root}/fixture.json`);
} catch (error) { console.error(error); process.exitCode = 1; await stop(); }
} finally { await slot.release(); }
