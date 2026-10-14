#!/usr/bin/env node
// One command, with managed fixture servers already ready:
// node ui/scripts/fast-chat-open-baseline.mjs [output.json] [url]
// Uses agent-browser's isolated Chromium session and the repo CDP client.
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
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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
        const transcript=document.querySelector('.transcript');
        const messages=[...document.querySelectorAll('.message-text')];
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
    process.stdout.write(`${id} ${kind}: ${measured.readableMs.toFixed(1)} ms\n`);
    assert.ok(measured.firstPaintMs >= 0);
  }
  // Warm the shared markdown/highlighter modules, not the fixture stores.
  await open("small", "Readable last turn 20.", "warmup");
  await open("streaming", "Readable streaming last turn.", "warmup");
  results.length = 0;
  await open("small", "Readable last turn 20.");
  await open("large", "Readable last turn 300.");
  await open("huge", "Readable last turn 1500.");
  await open("streaming", "Readable streaming last turn.");
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
