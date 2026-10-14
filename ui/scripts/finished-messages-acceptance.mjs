#!/usr/bin/env node
// Finished messages stay still: while a reply streams, and as a chat opens.
//
// Re-render modes record which messages re-render on each React commit while a
// reply streams, through React's DevTools commit hook (the fiber data the React
// Profiler reads). A message counts as re-rendered when any component in its
// subtree performed work in that commit. Mounts are counted separately.
//   app      The built production app against the fixture server
//            (scripts/fast-chat-open-server.mjs, --first-page). Opens the
//            "streaming" fixture; the server publishes one delta per second
//            through the real store and transcript projection.
//   harness  The Thread Caliper part's "Paging" scenario on the Vite dev
//            server: the huge fixture's shape (1500 turns, code and Mermaid in
//            every turn). Loads earlier pages first, then sends a message and
//            records the streamed reply.
//
// Open mode records the opening view, frame by frame, in the built app: the
// screencast's painted frames and, on every animation frame, where the last
// turn's marker sits and how far the transcript is from its bottom.
//   open     node ... open http://127.0.0.1:18671/ <out-dir> [fixture]
//
// Usage:
//   node ui/scripts/finished-messages-acceptance.mjs app http://127.0.0.1:18671/ [out.json]
//   node ui/scripts/finished-messages-acceptance.mjs harness http://127.0.0.1:18670/ [out.json] [pages]
// Real browsers only; happy-dom is not evidence for either. CHROME_BIN selects
// Chromium; otherwise the first chromium on PATH.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDP, evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";

const [mode = "app", base = mode === "harness" ? "http://127.0.0.1:18670/" : "http://127.0.0.1:18671/", outPath, extra] = process.argv.slice(2);
assert.ok(mode === "app" || mode === "harness" || mode === "open", `Unknown mode ${mode}`);
const earlierPages = Number(mode === "harness" ? extra ?? 20 : 0);
const openFixture = mode === "open" ? extra ?? "huge" : undefined;

// Open mode: every animation frame from the click, the last turn's marker and the transcript's distance from its bottom.
const OPEN_TRACE = String.raw`(() => {
  const trace = window.__open = { start: undefined, frames: [] };
  const tick = () => {
    const viewport = document.querySelector(".transcript");
    if (trace.start !== undefined && viewport) {
      const box = viewport.getBoundingClientRect();
      const marker = [...viewport.querySelectorAll(".markdown p")].findLast((node) => node.textContent.startsWith("Readable last turn"));
      const rect = marker?.getBoundingClientRect();
      trace.frames.push({ t: performance.now() - trace.start, messages: viewport.querySelectorAll("[data-message-id]").length,
        scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, gapToBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
        markerY: rect ? rect.top - box.top : null, markerVisible: rect ? rect.bottom > box.top && rect.top < box.bottom : false,
        drawn: viewport.querySelectorAll('.diagram[data-drawing="drawn"]').length });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

// Installed before React loads. React calls onCommitFiberRoot after each commit.
const HOOK = String.raw`(() => {
  const PERFORMED_WORK = 1;
  const COMPOSITE = new Set([0, 1, 11, 15]);
  // Commits are recorded under the current phase, so one run can separate the stream's deltas from the turn around them.
  const state = window.__renders = { phase: undefined, phases: {} };
  const nameOf = (fiber) => fiber.type?.displayName || fiber.type?.name || fiber.type?.render?.displayName || fiber.type?.render?.name || "anonymous";
  const add = (kind, id, name) => {
    const phase = state.phases[state.phase] ??= { commits: 0, updates: {}, mounts: {}, names: {} };
    phase[kind][id] = (phase[kind][id] ?? 0) + 1;
    if (kind === "updates") (phase.names[id] ??= {})[name] = (phase.names[id][name] ?? 0) + 1;
  };
  function visit(next, prev, ctx, ids) {
    // Each fiber a commit processed is a fresh work-in-progress whose alternate is the previous
    // current. When a parent's child pointer did not change, its whole subtree bailed out.
    for (let fiber = next; fiber; fiber = fiber.sibling) {
      const before = fiber.alternate;
      let own = ctx;
      if (own === undefined && typeof fiber.key === "string" && ids.has(fiber.key)) own = fiber.key;
      if (COMPOSITE.has(fiber.tag)) {
        if (before === null) add("mounts", own ?? "(thread)", nameOf(fiber));
        else if ((fiber.flags & PERFORMED_WORK) !== 0) add("updates", own ?? "(thread)", nameOf(fiber));
      }
      if (fiber.child && (before === null || fiber.child !== before.child)) visit(fiber.child, undefined, own, ids);
    }
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) {
      if (state.phase === undefined) return;
      (state.phases[state.phase] ??= { commits: 0, updates: {}, mounts: {}, names: {} }).commits++;
      const ids = new Set([...document.querySelectorAll("[data-message-id]")].map((element) => element.dataset.messageId));
      const current = root.current;
      if (current.child && current.child !== current.alternate?.child) visit(current.child, undefined, undefined, ids);
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, setStrictMode() {}, checkDCE() {},
  };
})()`;

const chromeBin = process.env.CHROME_BIN ?? findChrome();
assert.ok(chromeBin, "Chromium is required: set CHROME_BIN");
const profile = await mkdtemp(join(tmpdir(), "finished-messages-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
let cdp;
try {
  await waitForDebugger(port);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  const errors = [];
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text)]);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: mode === "open" ? OPEN_TRACE : HOOK });
  const until = async (expression, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(50); }
    throw new Error(`Timed out: ${expression}`);
  };
  const messageIds = () => evaluate(cdp, `[...document.querySelectorAll("[data-message-id]")].map((element) => element.dataset.messageId)`);
  let streamingId;
  let finishedIds;
  let windowMs;
  if (mode === "open") {
    assert.ok(outPath, "open mode needs an output folder");
    const folder = join(outPath, openFixture);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    await cdp.send("Page.navigate", { url: base });
    await until(`!!document.getElementById("picker-row-${openFixture}")`);
    // Painted frames, as the compositor produced them.
    const painted = [];
    cdp.listeners.set("Page.screencastFrame", [(frame) => {
      painted.push({ timestamp: frame.metadata.timestamp, data: frame.data });
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    }]);
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await sleep(300);
    const clickedAt = await evaluate(cdp, `(() => { window.__open.start = performance.now(); document.getElementById("picker-row-${openFixture}").click(); return Date.now() / 1000; })()`);
    await sleep(4000);
    await cdp.send("Page.stopScreencast");
    const frames = await evaluate(cdp, `window.__open.frames`);
    const shown = painted.filter((frame) => frame.timestamp >= clickedAt - 0.05);
    const files = [];
    for (const [index, frame] of shown.entries()) {
      const file = join(folder, `painted-${String(index).padStart(3, "0")}-${Math.round((frame.timestamp - clickedAt) * 1000)}ms.png`);
      await writeFile(file, Buffer.from(frame.data, "base64"));
      files.push(file);
    }
    const firstVisible = frames.findIndex((frame) => frame.markerVisible);
    const settled = frames.at(-1);
    const after = firstVisible < 0 ? [] : frames.slice(firstVisible);
    const markerMoves = after.slice(1).flatMap((frame, index) => frame.markerY !== null && after[index].markerY !== null && Math.abs(frame.markerY - after[index].markerY) >= 1
      ? [{ t: Math.round(frame.t), from: after[index].markerY, to: frame.markerY, drawnBefore: after[index].drawn, drawn: frame.drawn }] : []);
    // A move in the same frame as a Mermaid diagram finishing is that diagram growing; any other move is unexplained.
    const unexplained = markerMoves.filter((move) => move.drawn === move.drawnBefore);
    const summary = { mode, fixture: openFixture, base, chromium: (await cdp.send("Browser.getVersion")).product,
      firstMarkerVisibleMs: firstVisible < 0 ? null : Math.round(frames[firstVisible].t), frames: frames.length, paintedFrames: files.length,
      firstVisible: frames[firstVisible], settled, markerMovesAfterFirstVisible: markerMoves,
      settledGapToBottom: settled.gapToBottom, unexplainedMoves: unexplained, errors };
    await writeFile(join(folder, "trace.json"), `${JSON.stringify({ ...summary, trace: frames, painted: files }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    assert.ok(firstVisible >= 0, "The last turn became visible");
    assert.ok(frames[firstVisible].gapToBottom <= 1, "The first frame with the last turn is pinned to the bottom");
    assert.deepEqual(unexplained, [], "Every later move of the last turn coincides with a Mermaid diagram finishing its draw");
    // The transcript follows its tail while the reader stays at the bottom, so a late draw does not move the last turn either.
    assert.deepEqual(markerMoves, [], "The last turn does not move after it first shows, even while diagrams finish drawing");
    assert.ok(settled.gapToBottom <= 1, "The settled transcript is still pinned to the bottom");
    assert.deepEqual(errors, []);
  } else await recordStreaming();
  async function recordStreaming() {
    if (mode === "app") {
      await cdp.send("Page.navigate", { url: base });
      await until(`!!document.getElementById("picker-row-streaming")`);
      await evaluate(cdp, `document.getElementById("picker-row-streaming").click()`);
      await until(`[...document.querySelectorAll(".message-text")].some((node) => node.textContent.includes("Readable streaming last turn"))`);
      await sleep(1500);
      const ids = await messageIds();
      streamingId = await evaluate(cdp, `[...document.querySelectorAll("[data-message-id]")].find((node) => node.textContent.includes("Readable streaming last turn"))?.dataset.messageId`);
      finishedIds = ids.filter((id) => id !== streamingId);
      windowMs = 6_000;
      const before = await evaluate(cdp, `document.querySelector('[data-message-id="${streamingId}"]').textContent.length`);
      await evaluate(cdp, `window.__renders.phase = "deltas"`);
      await sleep(windowMs);
      await evaluate(cdp, `window.__renders.phase = undefined`);
      const after = await evaluate(cdp, `document.querySelector('[data-message-id="${streamingId}"]').textContent.length`);
      assert.ok(after > before, `The streaming reply grew during the window (${before} -> ${after} characters)`);
    } else {
      await cdp.send("Page.navigate", { url: new URL("/__caliper/frame?part=src/ui/Thread.organism.part.tsx&state=Paging", base).href });
      await until(`document.querySelectorAll("[data-message-id]").length > 0 && !!document.querySelector(".load-earlier button")`);
      for (let page = 0; page < earlierPages; page++) {
        const count = await evaluate(cdp, `document.querySelectorAll("[data-message-id]").length`);
        await evaluate(cdp, `document.querySelector(".load-earlier button").click()`);
        await until(`document.querySelectorAll("[data-message-id]").length > ${count}`);
      }
      await until(`!document.querySelector('.diagram[data-drawing="waiting"]')`, 120_000).catch(() => undefined);
      await sleep(1000);
      finishedIds = await messageIds();
      // A real send through the composer starts the scenario's streamed reply. Phases:
      // "start" appends the question and the reply, "deltas" is the stream itself, "end" settles it.
      const reply = `document.querySelector('[data-message-id^="stream-reply"]')`;
      await evaluate(cdp, `document.querySelector("[data-composer-input]").focus()`);
      await cdp.send("Input.insertText", { text: "Stream a reply while the history stays still." });
      await evaluate(cdp, `window.__renders.phase = "start"`);
      await evaluate(cdp, `document.querySelector('[aria-label="Send message"]').click()`);
      const started = Date.now();
      await until(`${reply}?.textContent.includes("Streamed paragraph 2.")`);
      await evaluate(cdp, `window.__renders.phase = "deltas"`);
      await until(`${reply}?.textContent.includes("Streamed paragraph 59.")`);
      await evaluate(cdp, `window.__renders.phase = "end"`);
      await until(`!!${reply}?.querySelector('[aria-label="Copy response"]')`);
      await sleep(500);
      windowMs = Date.now() - started;
      await evaluate(cdp, `window.__renders.phase = undefined`);
      streamingId = (await messageIds()).find((id) => id.startsWith("stream-reply"));
    }
    const { phases } = await evaluate(cdp, `window.__renders`);
    const summarize = (phase) => {
      const record = phases[phase] ?? { commits: 0, updates: {}, mounts: {}, names: {} };
      const finished = Object.fromEntries(finishedIds.map((id) => [id, record.updates[id] ?? 0]).filter(([, count]) => count > 0));
      const components = {};
      for (const id of Object.keys(finished)) for (const [name, count] of Object.entries(record.names[id] ?? {})) components[name] = (components[name] ?? 0) + count;
      return { commits: record.commits, streamingMessageUpdates: record.updates[streamingId] ?? 0, finishedMessagesReRendered: Object.keys(finished).length,
        finishedComponentRenders: components, threadLevelUpdates: record.updates["(thread)"] ?? 0,
        streamingComponents: record.names[streamingId] ?? {}, threadComponents: record.names["(thread)"] ?? {} };
    };
    const result = { mode, base, chromium: (await cdp.send("Browser.getVersion")).product, windowMs,
      finishedMessages: finishedIds.length, streamingId, phases: Object.fromEntries(Object.keys(phases).map((phase) => [phase, summarize(phase)])), errors };
    if (outPath) await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
    for (const [phase, entry] of Object.entries(result.phases)) {
      console.log(`${phase}: ${entry.commits} commits; streaming message ${entry.streamingMessageUpdates} component renders; ` +
        `${entry.finishedMessagesReRendered} of ${finishedIds.length} finished messages re-rendered ${JSON.stringify(entry.finishedComponentRenders)}; thread chrome ${entry.threadLevelUpdates}`);
    }
    const deltas = result.phases.deltas;
    assert.ok(deltas && deltas.commits > 0, "React committed while the reply streamed");
    assert.ok(deltas.streamingMessageUpdates > 0, "The streaming message re-rendered");
    assert.equal(deltas.finishedMessagesReRendered, 0, "No finished message re-rendered while another reply streamed");
    assert.deepEqual(errors, []);
  }
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
