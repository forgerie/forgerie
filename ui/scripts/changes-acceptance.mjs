#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Interaction checks for the changes review: the files tree, the CodeMirror diff, and notes.
// Runs at every Fold posture and a 1440 × 900 desktop window, in both color schemes, against
// the network-free preview. Saves a capture of each posture's arrival and open file to OUT.
// Nothing reaches Pi or git.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve(process.env.OUT ?? "/tmp/changes-acceptance");
const DESKTOP = { name: "desktop", width: 1440, height: 900 };
const postures = [...FOLD8_POSTURES, DESKTOP].filter((posture) => !process.env.POSTURES || process.env.POSTURES.split(",").includes(posture.name));
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
const profile = await mkdtemp(join(tmpdir(), "changes-acceptance-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
await mkdir(out, { recursive: true });

const js = (value) => JSON.stringify(value);
async function ready(cdp, expression, what = expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(cdp, expression)) return; await sleep(50); }
  throw new Error(`Never ready: ${what}`);
}
async function open(cdp, scenario) {
  await cdp.send("Page.navigate", { url: new URL(`/verification/changes-preview.html?scenario=${scenario}`, base).href });
  await ready(cdp, "document.readyState === 'complete' && !!document.querySelector('.changes-layout')", "the review");
  await evaluate(cdp, "document.fonts.ready.then(() => true)");
}
async function shot(cdp, label) {
  await sleep(350); // past the sheet's 300 ms slide
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, `${label}.png`), Buffer.from(data, "base64"));
}
const LOGIN = "unstaged:src/auth/LoginForm.tsx";
const SESSION = "unstaged:src/auth/session.ts";
const pane = "document.querySelector('.changes-pane')";
const barPath = "document.querySelector('.change-bar .change-path')?.title";
const sheet = "document.querySelector('.changes-layout')?.dataset.sheet";
const layout = "document.querySelector('.changes-layout')?.dataset.layout";
const row = (key) => `document.querySelector('.file-row[data-row=${js(key)}]')`;
/** The gutter cell whose new-side number is `line`, scrolled into the middle of the review. */
const cell = (line) => `(() => { const c = [...${pane}.querySelectorAll('.cm-diff-numbers .cm-gutterElement')].find(e => e.querySelector('.cm-diff-new')?.textContent === ${js(String(line))}); c?.scrollIntoView({ block: 'center' }); return c; })()`;
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
/** A finger drag from the pane's left side, rightward across `distance` CSS pixels. */
async function swipeRight(cdp, distance) {
  const { x, y } = await evaluate(cdp, `(() => { const r = ${pane}.getBoundingClientRect(); return { x: r.left + 24, y: r.top + r.height / 2 }; })()`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + distance * step / 10, y }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
}
const KEY_CODES = { Enter: 13, ArrowDown: 40, ArrowUp: 38, Escape: 27 };
async function key(cdp, key, code, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: KEY_CODES[key] ?? 0 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(120);
}
const noteRange = "document.querySelector('.note-editor .diff-note-range')?.textContent";
const typing = "document.activeElement?.matches('.note-editor textarea') ?? false";

const results = [];
try {
  await waitForDebugger(port);
  for (const scheme of ["dark", "light"]) {
    for (const posture of postures) {
      const desktop = posture === DESKTOP;
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      if (desktop) await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1, mobile: false });
      if (!desktop) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const errors = [];
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
      const label = `${scheme} ${posture.name}`;
      await open(cdp, "changes");

      // Desktop docks the tree beside the first file. Every Fold posture opens on the tree, as a sheet over the file.
      assert.equal(await evaluate(cdp, layout), desktop ? "docked" : "overlay", `${label}: layout`);
      assert.equal(await evaluate(cdp, "!!document.querySelector('.change-files-opener')"), !desktop, `${label}: Files button only when the tree is a sheet`);
      if (!desktop) assert.equal(await evaluate(cdp, sheet), "open", `${label}: the sheet shows the files on arrival`);
      assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.file-row')].map(r => r.querySelector('.file-name').textContent)"),
        ["Staged changes", "src/auth", "LoginForm.test.tsx", "Changes", "src/auth", "LoginForm.tsx", "session.ts", "vendor", "sso-client/"]);
      assert.equal(await evaluate(cdp, `${row(LOGIN)}.querySelector('.file-noted')?.textContent`), "1", `${label}: note count in the tree`);
      await shot(cdp, `arrival-${scheme}-${posture.name}`);

      // Choosing a file shows it. A sheet puts itself away and hands focus to the file's name.
      if (desktop) await mouseClick(cdp, row(LOGIN)); else await touchTap(cdp, row(LOGIN));
      await ready(cdp, `${barPath} === 'src/auth/LoginForm.tsx' && !!${pane}.querySelector('.tok-keyword')`, `${label}: LoginForm.tsx open`);
      if (!desktop) {
        assert.equal(await evaluate(cdp, sheet), "closed", `${label}: choosing a file closes the sheet`);
        assert.equal(await evaluate(cdp, "document.activeElement?.matches('.change-bar .change-path')"), true, `${label}: focus on the file's name`);
      }
      assert.equal(await evaluate(cdp, `${row(LOGIN)}.getAttribute('aria-selected')`), "true");
      assert.equal(await evaluate(cdp, "document.querySelector('.change-facts')?.textContent"), "ModifiedFile 2 of 31 note");
      await shot(cdp, `file-${scheme}-${posture.name}`);

      // The review never scrolls sideways, and the editor keeps the soft keyboard down.
      assert.equal(await evaluate(cdp, "(() => { const b = document.querySelector('.changes-body'); return b.scrollWidth <= b.clientWidth + 1; })()"), true, `${label}: sideways scroll`);
      assert.equal(await evaluate(cdp, `${pane}.querySelector('.cm-content').getAttribute('inputmode')`), "none");

      // Each line number sits on its line's text, after a note and a fold: within one CSS pixel.
      const drift = await evaluate(cdp, `(() => { let worst = 0; for (const c of ${pane}.querySelectorAll('.cm-diff-numbers .cm-gutterElement')) { if (getComputedStyle(c).visibility === 'hidden') continue;
        const n = c.querySelector('.cm-diff-new, .cm-diff-old'); if (!n || !n.textContent) continue;
        const top = c.getBoundingClientRect().top;
        const line = [...c.closest('.cm-editor').querySelectorAll('.cm-line')].sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top))[0];
        const text = line.firstChild && document.createRange(); if (!text) continue; text.selectNodeContents(line);
        const lineTop = (text.getClientRects()[0] ?? line.getBoundingClientRect()).top; const numberRange = document.createRange(); numberRange.selectNodeContents(n);
        worst = Math.max(worst, Math.abs(numberRange.getClientRects()[0].top - lineTop)); } return worst; })()`);
      assert.ok(drift <= 1, `${label}: numbers drift ${drift}px from their text`);

      // Next and previous walk the files in the tree's order.
      await mouseClick(cdp, "document.querySelector('[aria-label=\"Next file\"]')");
      await ready(cdp, `${barPath} === 'src/auth/session.ts'`, `${label}: next file`);
      assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Next file\"]').disabled"), true, `${label}: session.ts is the last file`);
      await mouseClick(cdp, "document.querySelector('[aria-label=\"Previous file\"]')");
      await ready(cdp, `${barPath} === 'src/auth/LoginForm.tsx' && !!${pane}.querySelector('.cm-diff-fold')`, `${label}: previous file`);

      // A fold opens in place and shows the lines it held.
      assert.equal(await evaluate(cdp, `${pane}.querySelector('.cm-diff-fold')?.textContent`), "Show 18 unchanged lines");
      await mouseClick(cdp, `${pane}.querySelector('.cm-diff-fold')`);
      await ready(cdp, `!!${cell(1)}`, "line 1 after unfolding");

      if (!desktop) {
        // A finger on the text picks the line and leaves the keyboard down. The same tap again puts it back.
        await touchTap(cdp, lineBeside(cell(20)));
        assert.equal(await evaluate(cdp, noteRange), "Note on line 20", `${label}: touch tap`);
        assert.equal(await evaluate(cdp, typing), false, `${label}: touch tap must not focus the note`);
        await sleep(600); // Past the double-tap window, where a second tap would select a word.
        await touchTap(cdp, lineBeside(cell(20)));
        assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: second tap clears`);

        // A swipe right brings the files in; Escape puts them away and keeps the review open.
        await swipeRight(cdp, 260);
        assert.equal(await evaluate(cdp, sheet), "open", `${label}: swipe opens the files`);
        await key(cdp, "Escape", "Escape");
        await sleep(250);
        assert.equal(await evaluate(cdp, sheet), "closed", `${label}: Escape closes the files first`);
        assert.equal(await evaluate(cdp, "!!document.querySelector('.changes-dialog[open]')"), true);
      } else {
        // Docked, the tree takes arrow keys and Enter, as an editor's file tree does, and focus stays in it.
        await mouseClick(cdp, row(LOGIN));
        await key(cdp, "ArrowDown", "ArrowDown");
        assert.equal(await evaluate(cdp, "document.activeElement?.dataset.row"), SESSION, `${label}: ArrowDown moves in the tree`);
        await key(cdp, "Enter", "Enter");
        await ready(cdp, `${barPath} === 'src/auth/session.ts'`, `${label}: Enter opens the file`);
        assert.equal(await evaluate(cdp, "document.activeElement?.dataset.row"), SESSION, `${label}: focus stays in the docked tree`);
        await key(cdp, "ArrowUp", "ArrowUp");
        await key(cdp, "Enter", "Enter");
        await ready(cdp, `${barPath} === 'src/auth/LoginForm.tsx' && !!${cell(30)}`, `${label}: back to LoginForm.tsx`);
      }

      // A mouse on the numbers picks the line and puts the caret in the note. Escape puts it away.
      await mouseClick(cdp, cell(30));
      assert.equal(await evaluate(cdp, noteRange), "Note on line 30");
      assert.equal(await evaluate(cdp, typing), true, `${label}: mouse on numbers focuses the note`);
      await key(cdp, "Escape", "Escape");
      assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: Escape clears the selection`);
      assert.equal(await evaluate(cdp, "!!document.querySelector('.changes-dialog[open]')"), true, `${label}: that Escape keeps the review open`);

      // A mouse on the text places a caret, as in an editor. Enter writes a note on the caret's line; Shift+Down stretches it.
      await mouseClick(cdp, lineBeside(cell(29)));
      assert.equal(await evaluate(cdp, "!!document.querySelector('.note-editor')"), false, `${label}: mouse on text only moves the caret`);
      await key(cdp, "ArrowDown", "ArrowDown", 8);
      await key(cdp, "Enter", "Enter");
      assert.equal(await evaluate(cdp, noteRange), "Note on lines 29–30", `${label}: keyboard selection`);
      assert.equal(await evaluate(cdp, typing), true);
      await cdp.send("Input.insertText", { text: "Name the notice prop for what it says." });
      const before = await evaluate(cdp, `${pane}.querySelectorAll('.diff-note[data-note-id]').length`);
      await key(cdp, "Enter", "Enter", 2);
      await ready(cdp, `${pane}.querySelectorAll('.diff-note[data-note-id]').length === ${before + 1}`, `${label}: Ctrl+Enter adds the note`);
      assert.equal(await evaluate(cdp, "document.querySelector('.changes-foot p')?.textContent"), "2 notes go with your next message.");
      assert.equal(await evaluate(cdp, `${row(LOGIN)}.querySelector('.file-noted')?.textContent`), "2", `${label}: the tree counts the new note`);
      assert.deepEqual(errors, [], `${label}: page errors`);
      await cdp.send("Page.close").catch(() => undefined);
      results.push(`${label}: ok (number drift ${drift.toFixed(2)}px)`);
    }
  }

  // A chip opens the review at its note's file, with the sheet away and focus on the note.
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Page.navigate", { url: new URL("/verification/changes-preview.html?scenario=changes-tray", base).href });
  await ready(cdp, "document.querySelectorAll('.note-chip-open').length === 3");
  await evaluate(cdp, "[...document.querySelectorAll('.note-chip-open')].find(b => b.title.startsWith('src/auth/session.ts')).click(), true");
  await ready(cdp, "document.activeElement?.getAttribute('aria-label') === 'Edit note'", "focus on the chip's note");
  assert.equal(await evaluate(cdp, barPath), "src/auth/session.ts");
  assert.equal(await evaluate(cdp, sheet), "closed");
  assert.equal(await evaluate(cdp, "(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  assert.match(await evaluate(cdp, "document.activeElement.closest('.diff-note').textContent"), /Strict breaks the SSO redirect/u);
  results.push("chip opens its note: ok");
  console.log(results.join("\n"));
  console.log(`captures: ${out}`);
} catch (error) {
  console.log(results.join("\n"));
  throw error;
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}
