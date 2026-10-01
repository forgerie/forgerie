#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { chromeArgs, findChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const profile = await mkdtemp(join(tmpdir(), "aui-dictation-"));
const port = await getFreePort();
const wav = process.env.DICTATION_WAV;
const chrome = spawn(process.env.CHROME_BIN ?? findChrome(), [...chromeArgs(port, profile),
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
], { stdio: "ignore" });
const base = process.env.APP_URL ?? "http://127.0.0.1:8524";
const out = resolve(process.env.SHOTS_DIR ?? "verification/local/dictation");
await mkdir(out, { recursive: true });
const result = { errors: [], requests: [], postures: [], live: undefined };
let cdp;
async function until(expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(40); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(label) { await evaluate(cdp, `document.querySelector('[aria-label="${label}"]').click()`); }
async function shot(label) {
  assert.equal(await evaluate(cdp, `!!document.querySelector('vite-error-overlay')`), false, 'Vite errors invalidate captures');
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(out, `${label}.png`), Buffer.from(data, "base64"));
}
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(e) => result.errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(e) => { if (new URL(e.request.url).pathname.startsWith("/api/")) result.requests.push({ url: e.request.url, method: e.request.method }); }]);
  await cdp.send("Page.navigate", { url: `${base}/verification/preview.html` });
  await until(`!!document.querySelector('[aria-label="Voice input"]')`);
  await evaluate(cdp, `document.querySelector('textarea').focus()`);
  await cdp.send("Input.insertText", { text: "Existing draft" });
  await click("Voice input");
  await until(`document.querySelector('.dictation-status')?.textContent === 'Listening…'`);
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of FOLD8_POSTURES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await sleep(100);
      const state = await evaluate(cdp, `({ draft: document.querySelector('textarea').value,
        overflow: document.documentElement.scrollWidth > innerWidth,
        rects: [...document.querySelectorAll('.composer-actions button')].map(e => e.getBoundingClientRect().toJSON()) })`);
      assert.equal(state.draft, "Existing draft"); assert.equal(state.overflow, false);
      for (const rect of state.rects) { assert.ok(rect.left >= 0 && rect.right <= posture.width && rect.top >= 0 && rect.bottom <= posture.height); }
      result.postures.push({ scheme, posture: posture.name, ...state });
      await shot(`${scheme}-${posture.name}-recording`);
    }
  }
  await click("Stop dictation");
  await until(`document.querySelector('textarea').value === 'Existing draft This is a local dictation preview.'`);
  assert.equal(result.requests.length, 0, "preview must not call a live API");
  // Ask mode shares the controls and the same input at every posture.
  await cdp.send("Page.navigate", { url: `${base}/verification/preview.html?scenario=ask` });
  await until(`!!document.querySelector('.ask')`); await click("Voice input");
  await until(`document.querySelector('.dictation-status')?.textContent === 'Listening…'`);
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of FOLD8_POSTURES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await sleep(100); await shot(`${scheme}-${posture.name}-ask-recording`);
      assert.equal(await evaluate(cdp, `[...document.querySelectorAll('textarea')].filter(e => e.getAttribute('aria-hidden') !== 'true').length`), 1);
    }
  }
  await click("Cancel dictation");
  await cdp.send("Page.navigate", { url: `${base}/verification/preview.html?scenario=dictation-error` });
  await until(`!!document.querySelector('[aria-label="Voice input"]')`); await click("Voice input");
  await until(`document.querySelector('[role="alert"]')?.textContent.includes('permission')`);
  await shot("permission-denied");
  if (wav) {
    await cdp.send("Page.navigate", { url: `${base}/verification/dictation-live.html` });
    await until(`!!document.querySelector('[aria-label="Voice input"]')`); await click("Voice input");
    await until(`document.querySelector('.dictation-status')?.textContent === 'Listening…'`);
    await sleep(7_000);
    await click("Stop dictation");
    await until(`!!document.querySelector('textarea').value`, 120_000);
    result.live = await evaluate(cdp, `({ text: document.querySelector('textarea').value, editable: !document.querySelector('textarea').disabled, secureContext: isSecureContext })`);
    assert.match(result.live.text.toLowerCase(), /fox/);
    assert.equal(result.live.editable, true);
    await shot("live-final");
    assert.ok(result.requests.some(e => e.url.endsWith('/api/speech/transcribe')));
  }
  assert.equal(result.errors.length, 0);
  assert.ok(result.requests.every(e => new URL(e.url).pathname.startsWith('/api/speech/')), "never prompt Pi");
  console.log(JSON.stringify(result, null, 2));
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify(result)); if (cdp) console.error(await evaluate(cdp, `document.body.innerText`)); throw error; }
finally { cdp?.close(); chrome.kill("SIGTERM"); await sleep(300); if (chrome.exitCode === null) chrome.kill("SIGKILL"); await rm(profile, { recursive: true, force: true }); }
