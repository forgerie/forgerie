#!/usr/bin/env node
// Older pages arrive above the reader without moving what they read.
//
// Drives the Thread Caliper part's "Paging" scenario (the fast-chat-open huge
// fixture's shape: a 60-line code block and a Mermaid diagram in every turn)
// on the Vite dev server, in a real Chromium at the four Fold 8 postures and a
// desktop window. happy-dom cannot prove scroll geometry.
//
// For each viewport:
//   1. Scrolls to the top, picks the first message that starts in view, and
//      records its y relative to the transcript. Clicks "load earlier
//      messages". Samples that y on every animation frame while the page
//      arrives, while the browser first draws the prepended (content-visibility)
//      messages, and while their Mermaid diagrams draw late.
//   2. Sends a message so a reply streams, scrolls up, and loads the next page
//      with the keyboard (Enter on the focused button). Samples again while the
//      reply streams below.
//   Each sample must stay within 1 CSS px of the first.
//   3. Steps a search through messages, one of them in a page that was
//      loaded above and never drawn, and checks each lands in view.
//   4. Checks that text in a finished message the browser skipped
//      (content-visibility) is still found by window.find, and whether it is in
//      the accessibility tree. The desktop pass turns accessibility on before
//      the page loads, as a running screen reader does; the unfolded-portrait
//      pass turns it on only afterwards. Only the first must expose the text;
//      the second is recorded as a finding.
//
//   5. (states) Captures each load-earlier state of the part, light and dark,
//      at every viewport, plus the available state with keyboard focus, and
//      checks the seam's geometry: the action keeps a full touch target and
//      nothing reaches past the thread column.
//
// Usage: node ui/scripts/load-earlier-acceptance.mjs http://127.0.0.1:18670/ [out-dir] [geometry|states|all]
// CHROME_BIN selects Chromium; otherwise the first chromium on PATH.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CDP, evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";

const base = process.argv[2] ?? "http://127.0.0.1:18670/";
const out = resolve(process.argv[3] ?? "verification/local/load-earlier");
const only = process.argv[4] ?? "all";
const TOLERANCE_PX = 1;
const SAMPLE_MS = 4500;
const viewports = [
  ...FOLD8_POSTURES.map((posture) => ({ ...posture, dpr: FOLD8_DPR, mobile: true })),
  { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false, accessibilityAtLoad: true },
];
const frameUrl = new URL("/__caliper/frame?part=src/ui/Thread.organism.part.tsx&state=Paging", base).href;

// In-page helpers: the transcript viewport, its messages, and a frame sampler.
const HELPERS = String.raw`(() => {
  const viewport = () => document.querySelector(".transcript");
  const messages = () => [...document.querySelectorAll(".transcript [data-message-id]")];
  window.__le = {
    viewport, messages,
    relativeY(id) {
      const element = document.querySelector('[data-message-id="' + CSS.escape(id) + '"]');
      return element ? element.getBoundingClientRect().top - viewport().getBoundingClientRect().top : null;
    },
    /** The first message that starts inside the transcript. */
    readerAnchor() {
      const top = viewport().getBoundingClientRect().top;
      return messages().find((element) => element.getBoundingClientRect().top >= top)?.dataset.messageId;
    },
    sample(id, ms) {
      return new Promise((resolve) => {
        const start = performance.now();
        const samples = [];
        const diagrams = () => document.querySelectorAll('.diagram[data-drawing="drawn"]').length;
        const tick = () => {
          const element = viewport();
          const streaming = document.querySelector(".message-assistant:not([data-finished])");
          samples.push({ t: Math.round(performance.now() - start), y: this.relativeY(id), scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight, count: messages().length, drawn: diagrams(), streamingLength: streaming?.textContent.length ?? 0 });
          if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve(samples);
        };
        requestAnimationFrame(tick);
      });
    },
  };
  return true;
})()`;

const chromeBin = process.env.CHROME_BIN ?? findChrome();
assert.ok(chromeBin, "Chromium is required: set CHROME_BIN");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "load-earlier-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const report = { base, frameUrl, tolerancePx: TOLERANCE_PX, viewports: [] };
let failures = 0;
try {
  await waitForDebugger(port);
  report.chromium = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  for (const viewport of only === "states" ? [] : viewports) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    const errors = [];
    cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text)]);
    const result = { viewport: viewport.name, width: viewport.width, height: viewport.height, dpr: viewport.dpr, errors };
    report.viewports.push(result);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      if (viewport.accessibilityAtLoad) await cdp.send("Accessibility.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: viewport.mobile });
      await cdp.send("Page.navigate", { url: frameUrl });
      const until = async (expression, timeoutMs = 60_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(50); }
        throw new Error(`Timed out: ${expression}`);
      };
      await until(`document.querySelectorAll(".transcript [data-message-id]").length > 0 && !!document.querySelector(".load-earlier-action")`);
      await evaluate(cdp, HELPERS);
      // Let the opening page settle: fonts, highlighting and the diagrams it shows.
      await until(`!document.querySelector('.diagram[data-drawing="waiting"]')`).catch(() => undefined);
      await sleep(500);
      const opened = await evaluate(cdp, `(() => { const v = __le.viewport(); return { scrollTop: v.scrollTop, scrollHeight: v.scrollHeight, clientHeight: v.clientHeight, messages: __le.messages().length }; })()`);
      result.opened = { ...opened, gapToBottom: opened.scrollHeight - opened.scrollTop - opened.clientHeight };

      // Waits until the transcript has not scrolled for half a second: the thread's own
      // scrolling (such as bringing a new turn to the top) must not run under a measurement.
      const settle = async () => {
        let last;
        let still = 0;
        for (let tries = 0; tries < 200 && still < 5; tries++) {
          const top = await evaluate(cdp, `__le.viewport().scrollTop`);
          still = top === last ? still + 1 : 0;
          last = top;
          await sleep(100);
        }
      };
      const measure = async (label, activate) => {
        // The reader scrolls to the oldest loaded message, as a person reaching the seam would.
        await settle();
        await evaluate(cdp, `__le.viewport().scrollTo({ top: 0, behavior: "instant" })`);
        await settle();
        const anchor = await evaluate(cdp, `__le.readerAnchor()`);
        const oldest = await evaluate(cdp, `__le.messages()[0].dataset.messageId`);
        assert.equal(anchor, oldest, `${viewport.name} ${label}: the reader is at the oldest loaded message before loading more`);
        const before = await evaluate(cdp, `__le.messages().length`);
        const sampling = evaluate(cdp, `__le.sample(${JSON.stringify(anchor)}, ${SAMPLE_MS})`);
        await sleep(50);
        await activate();
        const samples = await sampling;
        const y0 = samples[0].y;
        const deltas = samples.map((sample) => sample.y === null ? Infinity : Math.abs(sample.y - y0));
        const prependAt = samples.find((sample) => sample.count > before)?.t;
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        const png = join(out, `${viewport.name}-${label}.png`);
        await writeFile(png, Buffer.from(shot.data, "base64"));
        const entry = {
          label, anchor, y0, maxDeltaPx: Math.max(...deltas), frames: samples.length, prependedAtMs: prependAt,
          messagesBefore: before, messagesAfter: samples.at(-1).count,
          scrollTopChange: samples.at(-1).scrollTop - samples[0].scrollTop,
          diagramsDrawnDuring: samples.at(-1).drawn - samples[0].drawn,
          streamingGrewBy: samples.at(-1).streamingLength - samples[0].streamingLength,
          worst: samples[deltas.indexOf(Math.max(...deltas))], png,
        };
        result[label] = entry;
        const ok = entry.maxDeltaPx <= TOLERANCE_PX && entry.messagesAfter > entry.messagesBefore;
        if (!ok) failures++;
        console.log(`${viewport.name} ${label}: anchor ${anchor} max |Δy| ${entry.maxDeltaPx.toFixed(3)} px over ${entry.frames} frames; ` +
          `prepend at ${prependAt} ms, ${before} -> ${entry.messagesAfter} messages, scrollTop +${entry.scrollTopChange.toFixed(1)}, ` +
          `${entry.diagramsDrawnDuring} diagrams drawn during, stream +${entry.streamingGrewBy} chars ${ok ? "PASS" : "FAIL"}`);
        return entry;
      };

      // 1. Pointer: a real click on the seam.
      await measure("click", async () => {
        const box = await evaluate(cdp, `(() => { const r = document.querySelector(".load-earlier-action").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      });
      await until(`document.querySelector(".load-earlier-action")?.textContent === "load earlier messages"`);

      // 2. Keyboard, while a reply streams below.
      await evaluate(cdp, `document.querySelector("[data-composer-input]").focus()`);
      await cdp.send("Input.insertText", { text: "Stream a reply while the history stays still." });
      await evaluate(cdp, `document.querySelector('[aria-label="Send message"]').click()`);
      await until(`!!document.querySelector(".message-assistant:not([data-finished])")`);
      const streaming = await measure("keyboard-while-streaming", async () => {
        await evaluate(cdp, `document.querySelector(".load-earlier-action").focus()`);
        for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
      });
      if (streaming.streamingGrewBy <= 0) { failures++; console.log(`${viewport.name}: the reply did not stream during the sample FAIL`); }
      const focused = await evaluate(cdp, `document.activeElement?.className ?? ""`);
      result.focusAfterKeyboardLoad = focused;

      // 3. Search steps land on messages the browser has not drawn yet. Turn 1484 sits in a page
      //    loaded above and never drawn, so its neighbours still have estimated heights.
      await until(`!!document.querySelector(".message-assistant[data-message-id^='stream-reply'][data-finished]")`);
      await evaluate(cdp, `__le.viewport().scrollTo({ top: __le.viewport().scrollHeight, behavior: "instant" })`);
      await sleep(800);
      result.reveal = [];
      for (const id of ["user-1499", "user-1484", "user-1490"]) {
        const skipped = await evaluate(cdp, `!document.querySelector('[data-message-id="${id}"] .user-bubble').checkVisibility({ contentVisibilityAuto: true })`);
        await evaluate(cdp, `document.querySelector('.session-header .header-button').click()`);
        await sleep(2500);
        const landed = await evaluate(cdp, `(() => { const r = document.querySelector('[data-message-id="${id}"]').getBoundingClientRect(); const v = __le.viewport().getBoundingClientRect();
          return { top: Math.round(r.top - v.top), inView: r.top >= v.top && r.bottom <= v.bottom }; })()`);
        result.reveal.push({ id, skippedBefore: skipped, ...landed });
        console.log(`${viewport.name} reveal ${id} (skipped before: ${skipped}): top ${landed.top} px, in view ${landed.inView} ${landed.inView ? "PASS" : "FAIL"}`);
        if (!landed.inView) failures++;
      }

      // 4. A skipped finished message is still findable and in the accessibility tree.
      if (viewport.name === "desktop" || viewport.name === "unfolded-portrait") {
        const text = await evaluate(cdp, `(() => {
          const top = __le.viewport().getBoundingClientRect().bottom;
          const skipped = [...document.querySelectorAll(".message-assistant[data-finished]")]
            .find((element) => element.getBoundingClientRect().top > top + 2000 && !element.querySelector(".markdown").checkVisibility({ contentVisibilityAuto: true }));
          return skipped?.textContent.match(/Readable last turn \\d+\\./)?.[0];
        })()`);
        if (!text) console.log(JSON.stringify(await evaluate(cdp, `(() => { const v = __le.viewport(); return { scrollTop: v.scrollTop, bottom: v.getBoundingClientRect().bottom,
          rows: [...document.querySelectorAll(".message-assistant[data-finished]")].map((e) => [e.dataset.messageId, Math.round(e.getBoundingClientRect().top), e.querySelector(".markdown")?.checkVisibility({ contentVisibilityAuto: true })].join(" ")) }; })()`)));
        assert.ok(text, "A finished message far below the viewport is skipped by content-visibility");
        const ax = await cdp.send("Accessibility.getFullAXTree", {});
        const inTree = ax.nodes.some((node) => node.name?.value?.includes(text) && !node.ignored);
        const found = await evaluate(cdp, `(() => {
          getSelection().removeAllRanges();
          const found = window.find(${JSON.stringify(text)}, true, false, true);
          const node = getSelection().anchorNode?.parentElement?.closest("[data-message-id]");
          return { found, rendered: node ? node.querySelector(".markdown").checkVisibility({ contentVisibilityAuto: true }) : false, selected: String(getSelection()) };
        })()`);
        // window.find selects without scrolling, with or without content-visibility; the browser's find bar is not driven here.
        result.skippedText = { text, accessibilityAtLoad: viewport.accessibilityAtLoad === true, accessibilityTree: inTree, windowFind: found.found, selected: found.selected, renderedAfterFind: found.rendered };
        const required = viewport.accessibilityAtLoad === true;
        const ok = found.found && found.rendered && (!required || inTree);
        console.log(`${viewport.name} skipped text "${text}" (accessibility ${required ? "on before load" : "turned on after load"}): ` +
          `accessibility tree ${inTree}, window.find ${found.found}, rendered after find ${found.rendered} ${ok ? "PASS" : "FAIL"}${required ? "" : " (tree exposure recorded, not required)"}`);
        if (!ok) failures++;
      }
      if (errors.length) { failures++; console.log(`${viewport.name} errors: ${errors.join(" | ")}`); }
    } finally {
      cdp.close();
    }
  }
  if (only !== "geometry") await captureStates();
} finally {
  chrome.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
/** Each state at rest, light and dark, at every viewport. One image pixel is one CSS pixel. */
async function captureStates() {
  const states = ["default", "Loading", "Failed", "StartOfChat", "NoPaging"];
  report.states = [];
  for (const scheme of ["light", "dark"]) {
    await mkdir(join(out, "states", scheme), { recursive: true });
    for (const viewport of viewports) {
      for (const state of [...states, "default-focused"]) {
        const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
        const cdp = await CDP.connect(target.webSocketDebuggerUrl);
        const errors = [];
        cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text)]);
        try {
          await cdp.send("Page.enable");
          await cdp.send("Runtime.enable");
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
          await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
          const part = state === "default-focused" ? "default" : state;
          await cdp.send("Page.navigate", { url: new URL(`/__caliper/frame?part=src/ui/Thread.organism.part.tsx&state=${part}`, base).href });
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline && !await evaluate(cdp, `document.querySelectorAll("[data-message-id]").length > 0`)) await sleep(50);
          await evaluate(cdp, `document.fonts.ready.then(() => true)`);
          await sleep(300);
          // The reader has scrolled up to the oldest loaded message, where the seam is.
          await evaluate(cdp, `document.querySelector(".transcript").scrollTo({ top: 0, behavior: "instant" })`);
          if (state === "default-focused") {
            // A real Tab from the top of the document, so the browser decides whether focus is visible.
            await evaluate(cdp, `document.activeElement?.blur()`);
            for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          }
          await sleep(400);
          const geometry = await evaluate(cdp, `(() => {
            const seam = document.querySelector(".load-earlier");
            const column = document.querySelector(".thread-column").getBoundingClientRect();
            const action = document.querySelector(".load-earlier-action")?.getBoundingClientRect();
            const box = seam?.getBoundingClientRect();
            return { seam: !!seam, state: seam?.dataset.state ?? null, text: seam?.innerText.replace(/\\s+/g, " ").trim() ?? null,
              actionHeight: action?.height ?? null, actionWidth: action?.width ?? null,
              insideColumn: box ? box.left >= column.left - 0.5 && box.right <= column.right + 0.5 : null,
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
              focused: document.activeElement?.className ?? null,
              focusVisible: document.activeElement?.matches(".load-earlier-action:focus-visible") ?? false };
          })()`);
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          const png = join(out, "states", scheme, `${viewport.name}-${state}.png`);
          await writeFile(png, Buffer.from(shot.data, "base64"));
          const expectSeam = state !== "NoPaging";
          const ok = geometry.seam === expectSeam && errors.length === 0 && geometry.pageOverflow === false
            && (!expectSeam || geometry.insideColumn) && (geometry.actionHeight === null || geometry.actionHeight >= 44)
            && (state !== "default-focused" || geometry.focusVisible);
          if (!ok) failures++;
          report.states.push({ scheme, viewport: viewport.name, state, ...geometry, errors, png, ok });
          console.log(`${scheme} ${viewport.name} ${state}: ${JSON.stringify(geometry)} ${ok ? "PASS" : "FAIL"}`);
        } finally {
          cdp.close();
        }
      }
    }
  }
}
await writeFile(join(out, "load-earlier-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s). Report: ${join(out, "load-earlier-acceptance.json")}`);
process.exit(failures === 0 ? 0 : 1);
