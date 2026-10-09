#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Read-only live acceptance and in-memory interaction checks. Never restarts real services or edits real plugins.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES, FOLD8_DPR } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve(process.env.OUT ?? "verification/local/plugins");
const catalog = await (await fetch(new URL("/aui/plugins", base))).json();
const agents = await (await fetch(new URL("/aui/agents", base))).json();
const runtime = await (await fetch(new URL("/api/pi-web/runtime", base))).json();
assert.equal(catalog.profileDir, runtime.components.sessiond.activeAgentProfile.dir);
assert.equal(agents.userDir, join(catalog.profileDir, "agents"));
const paths = [join(catalog.profileDir, "settings.json"), catalog.configPath, join(homedir(), ".pi", "agent", "settings.json")];
const hashFiles = async () => Promise.all(paths.map(async (path) => {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}));
const before = await hashFiles();
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "plugins-browser-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
const chrome = launchChrome(chromeBin, port, profile);
const results = [];
async function ready(cdp, expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(cdp, expression)) return; await sleep(100); }
  throw new Error(`Never ready: ${expression}`);
}
async function navigate(cdp, path, expression) {
  await cdp.send("Page.navigate", { url: new URL(path, base).href });
  await ready(cdp, expression);
  await evaluate(cdp, "document.fonts.ready.then(() => true)"); await sleep(300);
}
async function shot(cdp, label) {
  if (process.env.CAPTURE === "0") return;
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(out, `${label}.png`), Buffer.from(data, "base64"));
}
const overflow = `document.querySelector('.settings-scroll').scrollWidth > document.querySelector('.settings-scroll').clientWidth + 1`;
const firstPackage = catalog.plugins.find((entry) => entry.kind === "package");
const inWindow = (selector) => `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`;
const clickText = (selector, text) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}); b.click(); return true; })()`;
const fixtureText = '{"five_hour": true, "retained_on_rotate": "draft"}';
try {
  await waitForDebugger(port);
  for (const scheme of ["dark", "light"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      const errors = []; cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.text)]);
      try {
        await navigate(cdp, "/?settings=root", "[...document.querySelectorAll('.settings-sections button')].some(b => b.textContent.includes('Plugins'))");
        assert.equal(await evaluate(cdp, overflow), false);
        await shot(cdp, `settings-${scheme}-${posture.name}`);
        await navigate(cdp, "/?settings=agents", "document.querySelectorAll('.agent-row').length > 0");
        assert.equal(await evaluate(cdp, overflow), false);
        await shot(cdp, `agents-${scheme}-${posture.name}`);
        await navigate(cdp, "/?settings=plugins", "document.querySelectorAll('.agent-row').length > 10");
        assert.equal(await evaluate(cdp, overflow), false);
        await shot(cdp, `list-${scheme}-${posture.name}`);
        // Reload and Restart live one tap away. The menu opens whole, inside the window.
        await evaluate(cdp, "document.querySelector('[aria-label=\"Plugin commands\"]').click()");
        await ready(cdp, "!!document.querySelector('.picker-menu')");
        await sleep(250); // past the 150 ms menu-in fade, or the capture shows a half-drawn menu
        assert.equal(await evaluate(cdp, inWindow(".picker-menu")), true);
        assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.picker-menu [role=menuitem]')].map(b => b.textContent).join('|').startsWith('Read plugins again|Restart Forgerie…')"), true);
        if (posture.name.startsWith("folded")) await shot(cdp, `menu-${scheme}-${posture.name}`);
        await evaluate(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true");
        await ready(cdp, "!document.querySelector('.picker-menu')");
        // All groups are reachable inside the same scrolling collection.
        await evaluate(cdp, "document.querySelector('.settings-scroll').scrollTop = document.querySelector('.settings-scroll').scrollHeight");
        assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.agent-group')].at(-1).getBoundingClientRect().top < innerHeight"), true);
        if (firstPackage) {
          await navigate(cdp, `/?settings=plugins&plugin=${encodeURIComponent(firstPackage.id)}`, "!!document.querySelector('.plugin-detail h2.agent-name')");
          assert.equal(await evaluate(cdp, overflow), false);
          await shot(cdp, `package-${scheme}-${posture.name}`);
        }
        await navigate(cdp, "/?settings=plugins&plugin=forgerie%3Acliproxyapi-quota", "!!document.querySelector('#plugin-settings')");
        assert.equal(await evaluate(cdp, overflow), false);
        await shot(cdp, `quota-${scheme}-${posture.name}`);
        // Interactions use the production binding with a real in-memory API, not intercepted network calls.
        // The fixture has states the live profile may lack: a pending restart, a package turned off, one not installed.
        await navigate(cdp, "/verification/plugins.html", "!!document.querySelector('.notice[data-tone=pending]') && document.querySelectorAll('.agent-row[data-dimmed]').length > 0");
        assert.equal(await evaluate(cdp, overflow), false);
        await shot(cdp, `pending-${scheme}-${posture.name}`);
        await navigate(cdp, "/verification/plugins.html?plugin=forgerie%3Aquota", "!!document.querySelector('#plugin-settings')");
        await evaluate(cdp, `(() => { const input = document.querySelector('#plugin-settings'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(fixtureText)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        for (const next of FOLD8_POSTURES) {
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: next.width, height: next.height, deviceScaleFactor: FOLD8_DPR, mobile: true });
          await sleep(100);
          assert.equal(await evaluate(cdp, "document.querySelector('#plugin-settings').value"), fixtureText);
          assert.equal(await evaluate(cdp, overflow), false);
        }
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: FOLD8_DPR, mobile: true });
        await evaluate(cdp, clickText(".notice button", "Restart…"));
        await ready(cdp, "!!document.querySelector('dialog[open]')");
        await sleep(250);
        assert.equal(await evaluate(cdp, inWindow("dialog .wt-card")), true);
        // Capture the two awkward shapes in both themes, and prove the other postures too.
        if (posture.name.startsWith("folded")) await shot(cdp, `confirm-${scheme}-${posture.name}`);
        await evaluate(cdp, clickText("dialog button", "Cancel"));
        await ready(cdp, "!document.querySelector('dialog')");
        assert.equal(await evaluate(cdp, "document.querySelector('#plugin-settings').value"), fixtureText);
        assert.deepEqual(errors, []);
        results.push({ scheme, posture: posture.name, settingsAndAgentsNoOverflow: true, liveGroupsReachable: true, menuInsideWindow: true, noOverflow: true, retainedDraftThroughAllPostures: true, confirmedRestartCancelled: true });
      } finally { cdp.close(); }
    }
  }
  // The install form remains usable in narrow-tall and wide-short containers.
  for (const posture of FOLD8_POSTURES.filter((entry) => entry.name.startsWith("folded"))) {
    const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: "dark" });
    try { await navigate(cdp, "/?settings=plugins&plugin=new", "!!document.querySelector('#plugin-source')");
      assert.equal(await evaluate(cdp, overflow), false);
      assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.session-header button')].some(b => b.textContent === 'Install')"), true);
      await shot(cdp, `add-dark-${posture.name}`);
    } finally { cdp.close(); }
  }
  assert.deepEqual(await hashFiles(), before, "Live settings changed during read-only acceptance");
} finally {
  chrome.kill("SIGTERM"); await sleep(300); if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
await writeFile(join(out, "report.json"), JSON.stringify({ url: base, captured: process.env.CAPTURE !== "0", profile: catalog.profileDir, counts: Object.fromEntries(["package", "extension", "forgerie", "builtin"].map((kind) => [kind, catalog.plugins.filter((entry) => entry.kind === kind).length])), results, liveSettingsUnchanged: true, unchangedFiles: paths }, null, 2));
console.log(JSON.stringify(results, null, 2));
