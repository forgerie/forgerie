#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Rich code blocks and editor commands in the composer, with real Chromium key
// input against the network-free fixture, at every Fold posture in both themes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const output = resolve(process.env.SHOT_DIR ?? "verification/local/composer-rich");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "forgerie-rich-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { combinations: [], sent: [], errors: [], apiRequests: [] };
const INPUT = "document.querySelector('[data-composer-input]')";
const LONG = "SELECT id, name, email, created_at, updated_at FROM accounts WHERE email LIKE '%@example.test' ORDER BY created_at DESC";
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (new URL(event.request.url).pathname.startsWith("/api/")) result.apiRequests.push(event.request.url); }]);
  async function until(expression) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(40); }
    throw new Error(`Timed out: ${expression}`);
  }
  const draft = () => evaluate(cdp, `${INPUT}.value`);
  const insert = (text) => cdp.send("Input.insertText", { text });
  // A physical Shift, as a hardware keyboard sends it.
  async function shiftEnter() {
    const shift = { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 };
    await cdp.send("Input.dispatchKeyEvent", { ...shift, type: "rawKeyDown" });
    await pressCombo(cdp, "shift+enter");
    await cdp.send("Input.dispatchKeyEvent", { ...shift, type: "keyUp", modifiers: 0 });
  }
  async function clear() {
    await evaluate(cdp, `${INPUT}.focus()`);
    await pressCombo(cdp, "ctrl+a"); await pressCombo(cdp, "backspace");
    assert.equal(await draft(), "");
  }
  for (const scheme of ["dark", "light"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "short-pane", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html` });
      await until(`!!${INPUT}`);
      await clear();
      // A typed fence becomes a block; one undo takes the whole conversion back.
      await insert("Check this query:"); await shiftEnter(); await insert("```sql"); await shiftEnter();
      assert.equal(await draft(), "Check this query:\n```sql\n\n```\n");
      await until("document.querySelector('.cm-code-block-header')?.textContent === 'sql'");
      assert.equal(await evaluate(cdp, `${INPUT}.textContent.includes('\`\`\`')`), false);
      await pressCombo(cdp, "ctrl+z"); assert.equal(await draft(), "Check this query:\n```sql");
      await pressCombo(cdp, "ctrl+y"); assert.equal(await draft(), "Check this query:\n```sql\n\n```\n");
      // Redo restores the text; put the caret back on the empty code line.
      await evaluate(cdp, `${INPUT}.setSelectionRange(${"Check this query:\n```sql\n".length}, ${"Check this query:\n```sql\n".length})`);
      await insert(LONG);
      await until("[...document.querySelectorAll('.cm-code-block-body .tok-keyword')].some((node) => node.textContent === 'SELECT')")
        .catch(async (error) => { console.error(JSON.stringify(await draft()), await evaluate(cdp, "document.querySelector('[data-composer-input]').innerHTML")); throw error; });
      // A long code line scrolls inside its block, not the page.
      const geometry = await evaluate(cdp, `(() => {
        const body = document.querySelector('.cm-code-block-body'), shell = document.querySelector('.composer-shell');
        const rect = (node) => node.getBoundingClientRect().toJSON();
        return { pageOverflow: document.documentElement.scrollWidth > innerWidth, bodyScrolls: body.scrollWidth > body.clientWidth,
          body: rect(body), header: rect(document.querySelector('.cm-code-block-header')), shell: rect(shell),
          buttons: [...document.querySelectorAll('.composer-actions button')].map((button) => ({ name: button.getAttribute('aria-label') || button.textContent, ...rect(button) })) };
      })()`);
      assert.equal(geometry.pageOverflow, false);
      assert.equal(geometry.bodyScrolls, true);
      for (const box of [geometry.body, geometry.header, geometry.shell]) assert.ok(box.left >= 0 && box.right <= posture.width + 0.5, JSON.stringify(box));
      for (const button of geometry.buttons) assert.ok(button.left >= 0 && button.right <= posture.width && button.top >= 0 && button.bottom <= posture.height, JSON.stringify(button));
      // Arrow Down leaves the block for prose, past the hidden closing fence.
      await pressCombo(cdp, "arrowdown"); await insert("Thanks.");
      assert.equal(await draft(), `Check this query:\n\`\`\`sql\n${LONG}\n\`\`\`\nThanks.`);
      // Backspace at the first code line keeps the hidden opener.
      await evaluate(cdp, `${INPUT}.setSelectionRange(${"Check this query:\n```sql\n".length}, ${"Check this query:\n```sql\n".length})`);
      await pressCombo(cdp, "backspace");
      assert.equal(await draft(), `Check this query:\n\`\`\`sql\n${LONG}\n\`\`\`\nThanks.`);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(output, `${scheme}-${posture.name}.png`), Buffer.from(data, "base64"));
      // Lists continue, and Tab indents.
      await clear(); await insert("- first"); await shiftEnter(); assert.equal(await draft(), "- first\n- ");
      await clear(); await insert("item"); await pressCombo(cdp, "arrowleft"); await pressCombo(cdp, "arrowleft");
      await pressCombo(cdp, "arrowleft"); await pressCombo(cdp, "arrowleft"); await pressCombo(cdp, "tab");
      assert.equal(await draft(), "  item");
      // Escape, then Tab, moves focus on instead of indenting, so the editor is no keyboard trap.
      await pressCombo(cdp, "escape"); await pressCombo(cdp, "tab");
      assert.equal(await evaluate(cdp, "document.activeElement?.matches('[data-composer-input]') ?? false"), false);
      assert.equal(await draft(), "  item");
      result.combinations.push({ scheme, posture: posture.name, fence: true, undo: true, highlight: true, leave: true, protect: true, list: true, tab: true, tabEscape: true, geometry });
    }
    // Enter sends the canonical Markdown, and the transcript draws it as code.
    await clear(); await insert("```sql"); await shiftEnter(); await insert("SELECT 1");
    await pressCombo(cdp, "enter");
    await until(`${INPUT}.value === '' && [...document.querySelectorAll('.message-user')].some((node) => node.textContent.includes('SELECT 1'))`);
    result.sent.push(scheme);
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.apiRequests, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.combinations.length, sent: result.sent, apiRequests: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
