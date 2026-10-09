#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Real touch input on the session sheet at every Fold posture: a swipe right
// opens it, a swipe left closes it, a short swipe falls back, a vertical
// scroll and a drag in sideways-scrolling code do not move it. Read-only:
// opens SESSION_ID and sends nothing.
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
const out = resolve("verification/local/swipe");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-swipe-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { postures: [], errors: [] };
let cdp;
const sheet = () => evaluate(cdp, "document.querySelector('.app-shell')?.dataset.sheet");
async function until(check, what) {
  const deadline = Date.now() + 20_000;
  while (!(await evaluate(cdp, check))) { if (Date.now() > deadline) assert.fail(`Timed out: ${what}`); await sleep(50); }
}
/** One finger from (x0, y0) to (x1, y1) in `steps` moves, like a thumb. */
async function swipe(x0, y0, x1, y1, steps = 12) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * step / steps, y: y0 + (y1 - y0) * step / steps }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(450);
}
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await cdp.send("Page.navigate", { url: new URL(`/?session=${encodeURIComponent(id)}`, app).href });
    await until("document.querySelector('.connection-status')?.textContent === 'Connected' && document.querySelectorAll('.message').length > 0", "session loaded");
    await sleep(300);
    const midY = Math.round(posture.height * 0.45);
    const row = { posture: posture.name };
    assert.equal(await sheet(), "closed", `${posture.name}: starts closed`);
    await swipe(20, midY, 60, midY);
    row.shortSwipe = await sheet();
    await swipe(Math.round(posture.width * 0.5), midY - 40, Math.round(posture.width * 0.5) + 20, midY + 160);
    row.verticalScroll = await sheet();
    await swipe(20, midY, Math.round(posture.width * 0.75), midY + 30);
    row.swipeRight = await sheet();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(out, `${posture.name}-open.png`), Buffer.from(data, "base64"));
    await swipe(Math.round(posture.width * 0.6), midY, 20, midY);
    row.swipeLeft = await sheet();
    result.postures.push(row);
    assert.deepEqual(row, { posture: posture.name, shortSwipe: "closed", verticalScroll: "closed", swipeRight: "open", swipeLeft: "closed" });
  }
  // A drag that starts in code that scrolls sideways moves the code, not the sheet. Few sessions
  // hold a line wide enough, so the check adds one code block with the app's own class.
  await evaluate(cdp, `(() => { const pre = document.createElement('pre'); pre.className = 'code-body'; pre.dataset.fixture = '';
    const code = document.createElement('code'); code.textContent = 'const path = "' + 'directory/'.repeat(40) + '";';
    pre.append(code); document.querySelector('.message-group')?.append(pre); pre.scrollLeft = 300; })()`);
  const code = await evaluate(cdp, `(() => { const pre = [...document.querySelectorAll('.code-body, .table-scroll')].find((el) => el.scrollWidth - el.clientWidth > 2 && ['auto','scroll'].includes(getComputedStyle(el).overflowX)); if (!pre) return null; pre.scrollIntoView({ block: 'center' }); const box = pre.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  if (code) {
    await sleep(300);
    await swipe(Math.round(code.x) - 80, Math.round(code.y), Math.round(code.x) + 80, Math.round(code.y));
    result.codeDrag = await sheet();
    result.codeScrollLeft = await evaluate(cdp, "document.querySelector('.code-body[data-fixture]').scrollLeft");
    assert.ok(result.codeScrollLeft < 300, 'the drag did not scroll the code');
    assert.equal(result.codeDrag, "closed", "a drag in scrolling code opened the sheet");
  } else result.codeDrag = "no sideways-scrolling block in this session";
  assert.deepEqual(result.errors, []);
} finally {
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
