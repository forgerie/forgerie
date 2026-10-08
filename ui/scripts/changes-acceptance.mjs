#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Interaction checks for the changes review's CodeMirror diff, at every Fold posture in both color schemes.
// Drives real input over CDP against the network-free preview. Nothing reaches Pi or git.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
const profile = await mkdtemp(join(tmpdir(), "changes-acceptance-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);

const js = (value) => JSON.stringify(value);
async function ready(cdp, expression, what = expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(cdp, expression)) return; await sleep(50); }
  throw new Error(`Never ready: ${what}`);
}
async function open(cdp, scenario) {
  await cdp.send("Page.navigate", { url: new URL(`/verification/changes-preview.html?scenario=${scenario}`, base).href });
  await ready(cdp, "document.readyState === 'complete'");
  await evaluate(cdp, "document.fonts.ready.then(() => true)");
}
/** The editor of one file, by its path. */
const editor = (path) => `[...document.querySelectorAll('.change-file')].find(f => f.querySelector('.change-path')?.title === ${js(path)})`;
/** The gutter cell whose new-side number is `line`, scrolled into the middle of the review. */
const cell = (path, line) => `(() => { const c = [...${editor(path)}.querySelectorAll('.cm-diff-numbers .cm-gutterElement')].find(e => e.querySelector('.cm-diff-new')?.textContent === ${js(String(line))}); c?.scrollIntoView({ block: 'center' }); return c; })()`;
/** The text line beside a gutter cell: the .cm-line whose top is nearest the cell's top. */
const lineBeside = (cellExpression) => `(() => { const c = ${cellExpression}; const top = c.getBoundingClientRect().top;
  return [...c.closest('.cm-editor').querySelectorAll('.cm-line')].sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top))[0]; })()`;
const center = async (cdp, expression) => {
  const box = await evaluate(cdp, `(() => { const e = (${expression}); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; })()`);
  assert.ok(box, `No element for ${expression}`);
  return box;
};
async function mouseClick(cdp, expression) {
  const { x, y } = await center(cdp, expression);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, pointerType: "mouse" });
  await sleep(120);
}
async function touchTap(cdp, expression) {
  const { x, y } = await center(cdp, expression);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(250);
}
async function key(cdp, key, code, modifiers = 0, text) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: { Enter: 13, ArrowDown: 40, Escape: 27 }[key] ?? 0, ...(text ? { text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(120);
}
const noteRange = "document.querySelector('.note-editor .diff-note-range')?.textContent";
const typing = "document.activeElement?.matches('.note-editor textarea') ?? false";

const results = [];
try {
  await waitForDebugger(port);
  for (const scheme of ["dark", "light"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const errors = [];
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
      const label = `${scheme} ${posture.name}`;
      const login = "src/auth/LoginForm.tsx";
      await open(cdp, "changes");
      await ready(cdp, `!!${editor(login)}?.querySelector('.tok-keyword')`, "syntax colour in LoginForm.tsx");

      // The review never scrolls sideways, and the editor keeps the soft keyboard down.
      assert.equal(await evaluate(cdp, "(() => { const b = document.querySelector('.changes-body'); return b.scrollWidth <= b.clientWidth + 1; })()"), true, `${label}: sideways scroll`);
      assert.equal(await evaluate(cdp, `${editor(login)}.querySelector('.cm-content').getAttribute('inputmode')`), "none");

      // Each line number sits on its line's text, after a note and a fold: within one CSS pixel.
      const drift = await evaluate(cdp, `(() => { let worst = 0; for (const c of ${editor(login)}.querySelectorAll('.cm-diff-numbers .cm-gutterElement')) { if (getComputedStyle(c).visibility === 'hidden') continue;
        const n = c.querySelector('.cm-diff-new, .cm-diff-old'); if (!n || !n.textContent) continue;
        const top = c.getBoundingClientRect().top;
        const line = [...c.closest('.cm-editor').querySelectorAll('.cm-line')].sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top))[0];
        const text = line.firstChild && document.createRange(); if (!text) continue; text.selectNodeContents(line);
        const lineTop = (text.getClientRects()[0] ?? line.getBoundingClientRect()).top; const numberRange = document.createRange(); numberRange.selectNodeContents(n);
        worst = Math.max(worst, Math.abs(numberRange.getClientRects()[0].top - lineTop)); } return worst; })()`);
      assert.ok(drift <= 1, `${label}: numbers drift ${drift}px from their text`);

      // A fold opens in place and shows the lines it held.
      assert.equal(await evaluate(cdp, `${editor(login)}.querySelector('.cm-diff-fold')?.textContent`), "Show 18 unchanged lines");
      await mouseClick(cdp, `${editor(login)}.querySelector('.cm-diff-fold')`);
      await ready(cdp, `!!${cell(login, 1)}`, "line 1 after unfolding");

      // A finger on the text picks the line and leaves the keyboard down. The same tap again puts it back.
      await touchTap(cdp, lineBeside(cell(login, 20)));
      assert.equal(await evaluate(cdp, noteRange), "Note on line 20", `${label}: touch tap`);
      assert.equal(await evaluate(cdp, typing), false, `${label}: touch tap must not focus the note`);
      await sleep(600); // Past the double-tap window, where a second tap would select a word.
      await touchTap(cdp, lineBeside(cell(login, 20)));
      assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: second tap clears`);

      // A mouse on the numbers picks the line and puts the caret in the note. Escape puts it away.
      await mouseClick(cdp, cell(login, 30));
      assert.equal(await evaluate(cdp, noteRange), "Note on line 30");
      assert.equal(await evaluate(cdp, typing), true, `${label}: mouse on numbers focuses the note`);
      await key(cdp, "Escape", "Escape");
      assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: Escape clears the selection`);
      assert.equal(await evaluate(cdp, "!!document.querySelector('.changes-dialog[open]')"), true, `${label}: first Escape keeps the review open`);

      // A mouse on the text places a caret, as in an editor. Enter writes a note on the caret's line; Shift+Down stretches it.
      await mouseClick(cdp, lineBeside(cell(login, 29)));
      assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: mouse on text only moves the caret`);
      await key(cdp, "ArrowDown", "ArrowDown", 8);
      await key(cdp, "Enter", "Enter");
      assert.equal(await evaluate(cdp, noteRange), "Note on lines 29–30", `${label}: keyboard selection`);
      assert.equal(await evaluate(cdp, typing), true);
      await cdp.send("Input.insertText", { text: "Name the notice prop for what it says." });
      const before = await evaluate(cdp, `${editor(login)}.querySelectorAll('.diff-note[data-note-id]').length`);
      await key(cdp, "Enter", "Enter", 2);
      await ready(cdp, `${editor(login)}.querySelectorAll('.diff-note[data-note-id]').length === ${before + 1}`, `${label}: Ctrl+Enter adds the note`);
      assert.equal(await evaluate(cdp, "document.querySelector('.changes-foot p')?.textContent"), "2 notes go with your next message.");
      assert.deepEqual(errors, [], `${label}: page errors`);
      await cdp.send("Page.close").catch(() => undefined);
      results.push(`${label}: ok (number drift ${drift.toFixed(2)}px)`);
    }
  }

  // A chip opens the review at its note, scrolled into the window, with focus on the note.
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "dark" });
  await open(cdp, "changes-tray");
  await ready(cdp, "document.querySelectorAll('.note-chip-open').length === 3");
  await evaluate(cdp, "[...document.querySelectorAll('.note-chip-open')].find(b => b.title.startsWith('src/auth/session.ts')).click(), true");
  await ready(cdp, "document.activeElement?.getAttribute('aria-label') === 'Edit note'", "focus on the chip's note");
  assert.equal(await evaluate(cdp, "(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  assert.match(await evaluate(cdp, "document.activeElement.closest('.diff-note').textContent"), /Strict breaks the SSO redirect/u);
  results.push("chip opens its note: ok");
  console.log(results.join("\n"));
} catch (error) {
  console.log(results.join("\n"));
  throw error;
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}
