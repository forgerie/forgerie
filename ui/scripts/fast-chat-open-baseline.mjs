#!/usr/bin/env node
// One command, with managed fixture servers already ready:
// node ui/scripts/fast-chat-open-baseline.mjs [output.json] [url]
// Uses agent-browser's isolated Chromium session and the repo CDP client.
//
// Protocol for the kept-screen app (review round 1 of fast-chat-open):
// - it reads the VISIBLE transcript, because hidden kept chats stay in the DOM;
// - each cold sample runs in a fresh tab, warmed up on another chat, so the measured chat is uncached;
// - navigator.connection.saveData=true switches idle prefetch off, and each cold sample asserts that
//   the measured session made no request before its one /open. Real use may prefetch, so cold numbers
//   are conservative;
// - "revisit" returns to a kept screen.
// The 2026-10-14 baseline (before kept screens) used one tab and the first .transcript; compare with
// that protocol difference in mind. Timing, geometry, GC and rAF definitions are unchanged.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { CDP, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
const url = process.argv[3] ?? "http://127.0.0.1:18641/";
const session = `fast-${process.pid}`;
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 120000 });
let cdp;
const results = [];
try {
  browser("open", url);
  const address = browser("get", "cdp-url").trim();
  const port = new URL(address).port;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.connect(pages.find(page => page.type === "page" && page.url.startsWith(url)).webSocketDebuggerUrl);
  let targetId = pages.find(page => page.type === "page" && page.url.startsWith(url)).id;
  let initiated = [];
  async function freshPage() {
    // A fresh tab, not back/forward-cache-retained documents in one tab.
    cdp.close(); await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    targetId = target.id; cdp = await CDP.connect(target.webSocketDebuggerUrl);
    initiated = [];
    await cdp.send("Performance.enable"); await cdp.send("Network.enable");
    cdp.listeners.set("Network.requestWillBeSent", [event => { if (event.request.url.includes("/api/")) initiated.push(event.request.url); }]);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'connection', {value:{saveData:true,effectiveType:'4g'},configurable:true})` });
    await cdp.send("Page.navigate", { url });
    for (let tries=0; tries<300; tries++) {
      if (await evaluate(cdp, `navigator.connection?.saveData===true && !!document.getElementById('picker-row-small')`)) break;
      await sleep(100);
    }
    assert.equal(await evaluate(cdp, `navigator.connection?.saveData===true && !!document.getElementById('picker-row-small')`), true);
  // Only JSON decoding is instrumented. No fetch replacement/interception.
  // This exposes UTF-8 decode + JSON parse separately from React/schema work.
  await evaluate(cdp, `(() => {
    window.__parse = [];
    Response.prototype.json = async function() {
      const text = await this.text(); const start = performance.now();
      const value = JSON.parse(text);
      window.__parse.push({url:this.url, ms:performance.now()-start}); return value;
    };
    return true;
  })()`);
  }
  await freshPage();
  const until = async expression => {
    for (let tries = 0; tries < 300; tries++) { if (await evaluate(cdp, expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  await until(`!!document.getElementById('picker-row-small')`);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
  async function open(id, marker, kind = "uncached") {
    // Remove dead DOM from the previous unmounted fixture before timing. This
    // makes per-open heap readings comparable and avoids a huge fixture's GC
    // being charged to the next small fixture. Natural-GC costs are excluded.
    await cdp.send("HeapProfiler.collectGarbage");
    if (kind === "uncached") assert.equal(initiated.filter(path => new URL(path).pathname.startsWith(`/api/sessions/${id}/`)).length, 0, "no earlier measured-session request");
    if (kind === "uncached") assert.equal(await evaluate(cdp, `performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname.startsWith('/api/sessions/${id}/') && /\\/(open|messages|status|stream-snapshot)$/u.test(new URL(e.name).pathname)).length`), 0, "no earlier transcript request for measured session");
    const before = await metrics();
    const measured = await evaluate(cdp, `new Promise((resolve, reject) => {
      const id=${JSON.stringify(id)}, marker=${JSON.stringify(marker)};
      const row=document.getElementById('picker-row-'+id);
      if (!row) { reject(new Error('Missing picker row '+id)); return; }
      performance.clearResourceTimings(); window.__parse=[];
      const click=performance.now(); let first;
      window.__measurementStart=click;
      row.click();
      const tick=()=>{
        const transcript=[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0 && node.closest('.session-shell')?.querySelector('.session-title')?.textContent === 'Baseline '+id);
        const messages=transcript?[...transcript.querySelectorAll('.message-text')]:[];
        const box=transcript?.getBoundingClientRect();
        const visible=node=>{const r=node.getBoundingClientRect(); return box && r.bottom>box.top && r.top<box.bottom && r.width>0;};
        if (first===undefined && messages.some(visible)) first=performance.now()-click;
        const last=messages.find(node=>node.textContent.includes(marker));
        if(last && visible(last)) requestAnimationFrame(()=>resolve({
          firstPaintMs:first, readableMs:performance.now()-click,
          domNodes:document.querySelectorAll('*').length,
          parses:window.__parse,
          requests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({
            path:new URL(e.name).pathname, durationMs:e.duration, ttfbMs:e.responseStart-e.startTime,
            downloadMs:e.responseEnd-e.responseStart, bytes:e.decodedBodySize
          }))
        }));
        else if(performance.now()-click>180000) reject(new Error('Last turn not visible '+id));
        else requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    })`);
    const after = await metrics();
    await cdp.send("HeapProfiler.collectGarbage");
    const retained = await metrics();
    const parsingMs = measured.parses.reduce((sum, parse) => sum + parse.ms, 0);
    const mainThreadMs = (after.TaskDuration - before.TaskDuration) * 1000;
    results.push({ fixture: id, kind, ...measured, parsingMs,
      mainThreadMs, renderMs: mainThreadMs - parsingMs,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutStyleMs: (after.LayoutDuration - before.LayoutDuration + after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      heapMiB: after.JSHeapUsedSize / 1048576, retainedHeapMiB: retained.JSHeapUsedSize / 1048576 });
    if (kind === "uncached") assert.deepEqual(measured.requests.filter(r=>/\/(open|messages|status|stream-snapshot)$/u.test(r.path)).map(r=>r.path), [`/api/sessions/${id}/open`], "exactly one cold open");
    process.stdout.write(`${id} ${kind}: ${measured.readableMs.toFixed(1)} ms\n`);
    assert.ok(measured.firstPaintMs >= 0);
  }
  // Non-identical protocol: each cold fixture has a fresh page and two warmups,
  // never warming the measured fixture. saveData disables speculative prefetch only.
  for (const [id,marker] of [["small","Readable last turn 20."],["large","Readable last turn 300."],["huge","Readable last turn 1500."],["streaming","Readable streaming last turn."]]) {
    await freshPage();
    await open(id === "small" ? "large" : "small", id === "small" ? "Readable last turn 300." : "Readable last turn 20.", "warmup");
    await open(id === "streaming" ? "large" : "streaming", id === "streaming" ? "Readable last turn 300." : "Readable streaming last turn.", "warmup");
    results.splice(results.findIndex(r=>r.kind==="warmup"));
    await open(id,marker);
  }
  await open("small", "Readable last turn 20.", "revisit-seed");
  const openedAt = Date.now();
  await open("streaming", "Readable streaming last turn.", "away");
  await sleep(Math.max(0, openedAt + 10000 - Date.now()));
  await open("small", "Readable last turn 20.", "revisit-10s");
  const output = { url, viewport: "1440x900 DPR1", instrumentedJson: true, forcedGcBetweenOpens: true, results };
  await writeFile(process.argv[2] ?? "/tmp/fast-chat-open-baseline.json", JSON.stringify(output, null, 2));
} finally {
  cdp?.close(); browser("close");
}
