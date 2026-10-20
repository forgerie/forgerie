#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Verify a running native fixture through its public web edge. Read-only except
// the optional token-guarded daemon restart of the fixture's own child daemon.
// Usage: node scripts/stack-latency-native-check.mjs /tmp/fg-native-UNIQUE/fixture.json [--restart]
import assert from "node:assert/strict";
import { readFile, readdir, readlink } from "node:fs/promises";
import WebSocket from "ws";

const [path, flag] = process.argv.slice(2);
assert.ok(path, "fixture.json path required");
const fixture = JSON.parse(await readFile(path, "utf8"));
assert.equal(fixture.version, 1);
assert.equal(new URL(fixture.origin).hostname, "127.0.0.1", "Only loopback fixtures");

async function verifyNative() {
  for (const session of fixture.sessions) {
    const response = await fetch(`${fixture.origin}/api/sessions/${session.id}/open?${new URLSearchParams({ cwd: session.cwd, limit: "50" })}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `open ${session.id}: HTTP ${response.status}`);
    const body = await response.json();
    assert.equal(body.readPath, "native", "HTTP open must be native");
    assert.ok(JSON.stringify(body.page.messages).includes(session.marker), "Destination marker missing from the native page");
  }
  const session = fixture.sessions[0];
  const socket = new WebSocket(`${fixture.origin.replace("http", "ws")}/api/sessions/${session.id}/events?${new URLSearchParams({ cwd: session.cwd, native: "1", open: "1" })}`);
  try {
    const frame = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Native socket open timed out")), 30000);
      socket.once("error", reject);
      socket.once("message", data => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
    });
    assert.equal(frame.type, "session.open", "First native frame must be the open checkpoint");
    assert.equal(frame.open.readPath, "native");
  } finally { socket.terminate(); }
}

// A long-lived fixture process must never keep a heavy-slot descriptor.
async function assertNoSlotDescriptor(pid) {
  for (const fd of await readdir(`/proc/${pid}/fd`)) {
    const target = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "");
    assert.ok(!target.includes("heavy-slot-"), `PID ${pid} holds ${target}`);
  }
}

await verifyNative();
const metrics = await (await fetch(`${fixture.origin}/__fixtures/metrics`)).json();
await assertNoSlotDescriptor(metrics.pid);
await assertNoSlotDescriptor(metrics.daemonPid);
const result = { native: true, sessions: fixture.sessions.length, slotDescriptors: 0, restart: "not requested" };
if (flag === "--restart") {
  const before = metrics.daemonPid;
  const response = await fetch(`${fixture.origin}/__fixtures/restart-daemon`, { method: "POST", headers: { "x-fixture-token": fixture.token }, signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200, `restart: HTTP ${response.status}`);
  const after = (await (await fetch(`${fixture.origin}/__fixtures/metrics`)).json()).daemonPid;
  assert.notEqual(after, before, "Daemon restart must replace the owner");
  await verifyNative();
  await assertNoSlotDescriptor(after);
  const refused = await fetch(`${fixture.origin}/__fixtures/restart-daemon`, { method: "POST" });
  assert.equal(refused.status, 403, "Restart without the fixture token must be refused");
  result.restart = "graceful restart verified; tokenless restart refused";
}
console.log(`NATIVE_FIXTURE_CHECK_OK ${JSON.stringify(result)}`);
