#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Read-only check against a real session: every successful handoff_session and
// spawn_session result in history renders one door, a door opens its session,
// and browser Back returns. Sends no prompt and makes no API write.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const id = process.env.SESSION_ID;
assert.ok(id, "Set SESSION_ID");
const app = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve("verification/local/real-handoff");
await mkdir(out, { recursive: true });

const catalog = await (await fetch(new URL("/api/sessions/all", app))).json();
const session = catalog.sessions.find((item) => item.id === id);
assert.ok(session, "Session must exist");
const page = await (await fetch(new URL(`/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd: session.cwd })}`, app))).json();
const idKey = { handoff_session: "destinationSessionId", spawn_session: "sessionId" };
const expected = page.messages.flatMap((message) => {
  const key = idKey[message.toolName];
  const target = key && message.role === "toolResult" && !message.isError ? message.details?.[key] : undefined;
  return target && message.details?.cwd ? [target] : [];
});
assert.ok(expected.length > 0, "The session must hold at least one successful handoff or spawn");

const profile = await mkdtemp(join(tmpdir(), "aui-real-handoff-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { expected: expected.length, errors: [], writes: [] };
async function until(cdp, check, what, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!(await evaluate(cdp, check))) {
    if (Date.now() >= deadline) {
      const status = await evaluate(cdp, `({ status: document.querySelector(".connection-status")?.textContent, error: document.querySelector(".notice")?.textContent, url: location.href })`);
      assert.fail(`Timed out: ${what} ${JSON.stringify(status)}`);
    }
    await sleep(100);
  }
}
// Any settled state: a real session can be idle, running, or waiting on an ask.
const loaded = `!["Connecting", "Reconnecting", "Disconnected", undefined].includes(document.querySelector('.connection-status')?.textContent) && document.querySelectorAll('.message').length > 0`;
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
    if (new URL(request.url).pathname.startsWith("/api/") && request.method !== "GET") result.writes.push(`${request.method} ${request.url}`);
  }]);
  await cdp.send("Page.navigate", { url: `${app}?${new URLSearchParams({ session: id })}` });
  await until(cdp, loaded, "source session loads");
  await sleep(500);
  result.rendered = await evaluate(cdp, `(() => {
    const doors = [...document.querySelectorAll(".session-door")];
    return { doors: doors.length, labels: [...new Set(doors.map((door) => door.querySelector(".session-door-open")?.textContent))],
      insideGroups: document.querySelectorAll("details.chain-of-thought .session-door").length };
  })()`);
  assert.equal(result.rendered.doors, expected.length, "one door per successful handoff or spawn");
  assert.equal(result.rendered.insideGroups, 0, "no door is hidden inside collapsed activity");

  // Open the last door with a real pointer press.
  const target = expected.at(-1);
  const point = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(".session-door-open")].at(-1);
    button.scrollIntoView({ block: "center" });
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  await until(cdp, `new URLSearchParams(location.search).get("session") === ${JSON.stringify(target)}`, "door switches the session");
  await until(cdp, loaded, "destination session loads");
  result.destination = await evaluate(cdp, `({ title: document.querySelector(".session-title")?.textContent, messages: document.querySelectorAll(".message").length })`);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, "destination.png"), Buffer.from(data, "base64"));

  // Browser Back returns to the session that created it.
  await evaluate(cdp, `history.back()`);
  await until(cdp, `new URLSearchParams(location.search).get("session") === ${JSON.stringify(id)}`, "Back returns to the source");
  await until(cdp, `document.querySelectorAll(".session-door").length === ${expected.length}`, "source doors render again");
  cdp.close();
  assert.deepEqual(result.writes, [], "the check must not write through the API");
  assert.deepEqual(result.errors, [], "no page exceptions");
  console.log(JSON.stringify(result, null, 2));
  console.log("real handoff check: passed");
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
