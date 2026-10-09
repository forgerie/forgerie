#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Creates and deletes only its own scratch session. Costs two short model replies.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES, FOLD8_DPR } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.ATTACHMENT_URL ?? "http://127.0.0.1:8514";
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const out = "verification/local/attachments";
await mkdir(out, { recursive: true });
const chromeBin = process.env.CHROME_BIN ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
const profile = await mkdtemp(join(tmpdir(), "aui-attachment-browser-"));
const workspace = await mkdtemp(join(tmpdir(), "aui-attachment-session-"));
const noteText = "Attachment acceptance: the test marker is violet-42.\n";
await writeFile(join(workspace, "notes.txt"), noteText);
await writeFile(join(workspace, "white.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAMElEQVR4nGMwTVxNEjp+5SlJiGHUglELRi0YtWDUglELRi0YtWDUglELRi0YKhYAANtngmqrX9EgAAAAAElFTkSuQmCC", "base64"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const errors = [];
const fixtureRequests = [];
const writes = [];
const checks = [];
let id;
async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}
async function wait(check, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw new Error(`Timed out: ${what}`);
}
async function open(posture, scheme, url, fixture = false) {
  const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      if (fixture) fixtureRequests.push(path);
      else if (request.method !== "GET") writes.push({ path, method: request.method, body: request.postData });
    }
  }]);
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20000);
  await cdp.send("Page.navigate", { url }); await loaded;
  return cdp;
}
async function click(cdp, label) {
  const result = await cdp.send("Runtime.evaluate", { expression: `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
    userGesture: true, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
}
async function addFiles(cdp, paths) {
  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const chooser = cdp.waitForEvent("Page.fileChooserOpened", 10000);
  // Attach a rejection handler before click awaits, so chooser timeout is
  // reported through the script's cleanup rather than an unhandled rejection.
  void chooser.catch(() => {});
  await click(cdp, "Add attachment");
  const event = await chooser;
  await cdp.send("DOM.setFileInputFiles", { files: paths, backendNodeId: event.backendNodeId });
}
async function shape(cdp, name) {
  const geometry = await evaluate(cdp, `(() => {
    const bar = document.querySelector('.composer-shell').getBoundingClientRect();
    const actions = document.querySelector('.composer-actions').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
      bar: { left: bar.left, right: bar.right, bottom: bar.bottom }, actions: { top: actions.top, bottom: actions.bottom },
      inputs: document.querySelectorAll('[data-composer-input]').length };
  })()`);
  assert.equal(geometry.overflow, false, `${name}: page overflow`);
  assert.equal(geometry.inputs, 1, `${name}: one composer`);
  assert.ok(geometry.bar.left >= 0 && geometry.bar.right <= geometry.width && geometry.bar.bottom <= geometry.height, `${name}: bar stays inside`);
  assert.ok(geometry.actions.top >= 0 && geometry.actions.bottom <= geometry.height, `${name}: actions stay inside`);
  checks.push({ name, ...geometry });
}
try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    for (const posture of FOLD8_POSTURES) {
      for (const scenario of ["attachments", "attachments-ask", "attachments-error"]) {
        const cdp = await open(posture, scheme, `${base}/verification/preview.html?scenario=${scenario}`, true);
        await wait(() => evaluate(cdp, `document.querySelectorAll('.composer-attachments .attachment').length === 2`), scenario);
        await shape(cdp, `${scheme}-${posture.name}-${scenario}`);
        await click(cdp, "Preview sample.png");
        await wait(() => evaluate(cdp, `!!document.querySelector('dialog[open]')`), "preview dialog");
        await click(cdp, "Close image viewer");
        cdp.close();
      }
    }
  }
  assert.deepEqual(fixtureRequests, [], "fixture must never call the API");
  // Reduced-height keyboard simulation and a narrow pane, still with all actions.
  for (const [width, height] of [[475, 280], [280, 500]]) {
    const posture = { ...FOLD8_POSTURES[0], name: `pane-${width}-${height}`, width, height };
    const cdp = await open(posture, "dark", `${base}/verification/preview.html?scenario=attachments-ask`, true);
    await wait(() => evaluate(cdp, `document.querySelectorAll('.composer-attachments .attachment').length === 2`), "small pane");
    await shape(cdp, posture.name); cdp.close();
  }

  const session = await call("/api/sessions", { cwd: workspace }); id = session.id ?? session.sessionId;
  assert.ok(id, "scratch session id");
  const query = new URLSearchParams({ cwd: workspace });
  await call(`/api/sessions/${id}/prompt`, { cwd: workspace, text: "This is a UI acceptance test. Reply with OK only. Do not use tools." });
  await wait(async () => !(await call(`/api/sessions/${id}/status?${query}`)).isStreaming
    && (await call("/api/sessions/all")).sessions.some((item) => item.id === id), "scratch session persisted", 120000);
  const cdp = await open(FOLD8_POSTURES.find((item) => item.name === "folded-portrait"), "dark", `${base}/?session=${id}`);
  await wait(() => evaluate(cdp, `document.querySelector('.connection-status')?.textContent === 'Connected'`), "session connected");
  await addFiles(cdp, [join(workspace, "notes.txt"), join(workspace, "white.png")]);
  await wait(() => evaluate(cdp, `document.querySelectorAll('.composer-attachments .attachment').length === 2`), "selected files");
  // The same draft and files survive all Fold transitions.
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: FOLD8_DPR, mobile: true });
    await shape(cdp, `real-${posture.name}`);
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.composer-attachments .attachment').length`), 2);
  }
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-composer-input]');
    input.value = 'This is a UI acceptance test. Reply with OK only. Do not use tools.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(cdp, "Send message");
  await wait(() => writes.some((request) => request.path.endsWith("/prompt")), "prompt request");
  await wait(async () => {
    const history = await call(`/api/sessions/${id}/messages?${query}`);
    return history.messages.some((message) => message.role === "user" && Array.isArray(message.content)
      && message.content.some((part) => part.type === "image")) && !(await call(`/api/sessions/${id}/status?${query}`)).isStreaming;
  }, "attachment persisted and reply ends", 120000);
  const uploads = writes.filter((request) => request.path.endsWith("/attachments"));
  const prompts = writes.filter((request) => request.path.endsWith("/prompt"));
  assert.equal(uploads.length, 1, "file upload once");
  assert.equal(prompts.length, 1, "prompt once");
  assert.equal(JSON.parse(uploads[0].body).cwd, workspace);
  const prompt = JSON.parse(prompts[0].body);
  assert.equal(prompt.cwd, workspace);
  assert.equal(prompt.attachments.length, 1, "image delivered inline");
  assert.equal(prompt.attachments[0].mimeType, "image/png");
  const reference = /@(.forgerie\/attachments\/\S+)/.exec(prompt.text)?.[1];
  assert.ok(reference, "saved reference in prompt");
  assert.equal(await readFile(join(workspace, reference), "utf8"), noteText);
  const history = await call(`/api/sessions/${id}/messages?${query}`);
  assert.ok(history.messages.some((message) => message.role === "user" && Array.isArray(message.content)
    && message.content.some((part) => part.type === "image")), "persisted native image");
  await addFiles(cdp, [join(workspace, "white.png")]);
  await wait(() => evaluate(cdp, `document.querySelectorAll('.composer-attachments .attachment').length === 1`), "image-only draft");
  assert.equal(await evaluate(cdp, `document.querySelector('[data-composer-input]').value`), "", "image-only composer has no text");
  await click(cdp, "Send message");
  await wait(() => writes.filter((request) => request.path.endsWith("/prompt")).length === 2, "image-only prompt once");
  await wait(() => evaluate(cdp, `document.querySelectorAll('.message-attachments .attachment-image').length >= 2`), "image-only live row");
  await wait(async () => {
    const messages = (await call(`/api/sessions/${id}/messages?${query}`)).messages;
    return messages.filter((message) => message.role === "user" && Array.isArray(message.content)
      && message.content.some((part) => part.type === "image")).length === 2
      && !(await call(`/api/sessions/${id}/status?${query}`)).isStreaming;
  }, "image-only persisted and reply ends", 120000);
  const imageOnly = JSON.parse(writes.filter((request) => request.path.endsWith("/prompt"))[1].body);
  assert.equal(imageOnly.text, "");
  assert.equal(imageOnly.attachments.length, 1);
  assert.equal(writes.filter((request) => request.path.endsWith("/attachments")).length, 1, "image-only does not upload");
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20000); await cdp.send("Page.reload"); await loaded;
  await wait(() => evaluate(cdp, `document.querySelectorAll('.message-attachments .attachment-image').length >= 2`), "image survives reload");
  assert.equal(await evaluate(cdp, `Array.from(document.querySelectorAll('.user-bubble')).some((bubble) => bubble.textContent.trim() === '')`), false, "image-only has no empty text bubble");
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, "real-image-after-reload.png"), Buffer.from(data, "base64"));
  cdp.close();
  assert.deepEqual(errors, [], "browser exceptions");
  assert.ok(writes.every((request) => request.path.startsWith(`/api/sessions/${id}/`)), "only scratch writes");
  await writeFile(join(out, "acceptance.json"), JSON.stringify({ checks, fixtureRequests, writes, errors, scratchSession: id }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, uploads: uploads.length, prompts: writes.filter((request) => request.path.endsWith("/prompt")).length, exceptions: errors.length }));
} finally {
  chrome.kill("SIGTERM"); await sleep(300); if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
  if (id) {
    await call(`/api/sessions/${id}/abort`, { cwd: workspace }).catch(() => {});
    await call(`/api/sessions/${id}/archive`, { cwd: workspace });
    await call("/api/sessions/bulk/delete-archived", { sessions: [{ id, cwd: workspace }] });
  }
  await rm(workspace, { recursive: true, force: true });
}
