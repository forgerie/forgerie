#!/usr/bin/env node
// node ui/scripts/fast-chat-open-acceptance.mjs <out.json> <page-url> [fixture-control-url]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CDP, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
const output = process.argv[2] ?? "/tmp/fast-chat-open-acceptance.json";
const url = process.argv[3] ?? "http://127.0.0.1:18650/";
// A Vite page proxies /api, not fixture controls. A built fixture server serves both.
const fixtureUrl = process.argv[4] ?? url;
async function streamingControl(action) {
  const response = await fetch(new URL(`/__fixtures/streaming/${action}`, fixtureUrl), { method: "POST" });
  assert.ok(response.ok, `fixture ${action}: HTTP ${response.status}`);
  const result = await response.json();
  assert.equal(result[action === "reset" ? "reset" : "completed"], true);
}
const session = `fast-acceptance-${process.pid}`;
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 120000 });
let cdp;
const result = { url, viewport: "1440x900 DPR1", prefetchSuppressedBySaveData: true, requests: [], opens: [], heapsMiB: [] };
try {
  await streamingControl("reset");
  browser("open", url);
  const port = new URL(browser("get", "cdp-url").trim()).port;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.connect(pages.find(page => page.type === "page" && page.url.startsWith(url)).webSocketDebuggerUrl);
  await cdp.send("Network.enable"); await cdp.send("Performance.enable");
  cdp.listeners.set("Network.requestWillBeSent", [event => {
    if (event.request.url.includes("/api/")) result.requests.push({ path: new URL(event.request.url).pathname, method: event.request.method, at: event.wallTime * 1000, id: event.requestId });
  }]);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__saveDataBoot=Date.now();Object.defineProperty(navigator, 'connection', {value:{saveData:true,effectiveType:'4g'},configurable:true})` });
  await cdp.send("Page.reload", { ignoreCache: false });
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(cdp, expression)) return; await sleep(50); }
    throw new Error(`Timed out ${expression}`);
  };
  await until(`window.__saveDataBoot && navigator.connection.saveData===true && !!document.getElementById('picker-row-huge-6')`);
  await sleep(250);
  async function heap(label) {
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    result.heapsMiB.push({ label, heap: usage.usedSize / 1048576, embedder: (usage.embedderHeapUsedSize ?? 0) / 1048576 });
  }
  await heap("empty");
  async function open(id, kept = false, marker = "Readable last turn 1500.") {
    const startIndex = result.requests.length;
    const measurement = await evaluate(cdp, `new Promise((resolve,reject)=>{
      const id=${JSON.stringify(id)}, kept=${kept}, markerText=${JSON.stringify(marker)};
      const click=performance.now(), at=performance.timeOrigin+click;
      document.getElementById('picker-row-'+id).click();
      let frames=0, firstFrameVisible=false, firstFrameCachedVisible=false, firstFrameAt;
      const tick=()=>{
        frames++;
        const transcript=[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0);
        const messages=transcript?[...transcript.querySelectorAll('.message-text')]:[];
        const box=transcript?.getBoundingClientRect();
        const marker=messages.find(node=>node.textContent.includes(markerText));
        const r=marker?.getBoundingClientRect();
        const visible=!!(box&&r&&r.width>0&&r.bottom>box.top&&r.top<box.bottom);
        if(frames===1){firstFrameVisible=visible;firstFrameAt=performance.timeOrigin+performance.now();firstFrameCachedVisible=messages.some(node=>{const r=node.getBoundingClientRect();return box&&r.width>0&&r.bottom>box.top&&r.top<box.bottom;});}
        if(visible)resolve({id,kept,at,firstFrameAt,firstFrameVisible,firstFrameCachedVisible,frames,paintAt:performance.timeOrigin+performance.now(),readableMs:performance.now()-click,domNodes:document.querySelectorAll('*').length});
        else if(performance.now()-click>15000)reject(new Error('No readable last turn '+id));
        else requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    })`);
    await sleep(200);
    measurement.requests = result.requests.slice(startIndex);
    measurement.throughFirstFrame = measurement.requests.filter(request => request.at <= measurement.firstFrameAt);
    measurement.postPaintRequests = measurement.requests.filter(request => request.at > measurement.paintAt);
    result.opens.push(measurement);
    if (id === "streaming" && kept) result.hiddenCompletion = {
      firstFrameMs: measurement.firstFrameAt - measurement.at, finalFrame: measurement.frames,
      finalReadableMs: measurement.readableMs, firstFrameHadFinal: measurement.firstFrameVisible,
      postPaintRequests: measurement.postPaintRequests,
    };
    process.stdout.write(`${id} kept=${kept} frames=${measurement.frames} readable=${measurement.readableMs.toFixed(1)}ms requestsThroughFirstFrame=${measurement.throughFirstFrame.length}\n`);
    if (kept) {
      assert.equal(measurement.firstFrameCachedVisible, true, "cached transcript must be visible on first frame");
      assert.equal(measurement.firstFrameVisible, true, "kept final content must be readable on first frame");
      assert.deepEqual(measurement.throughFirstFrame, [], "kept selection must start zero requests through first paint");
    } else {
      assert.equal(measurement.requests.filter(request => /\/(open|messages|status|stream-snapshot)$/u.test(request.path)).length, 1, "cold open must use exactly one transcript HTTP read");
    }
  }
  for (let count = 1; count <= 6; count++) {
    await open(count === 1 ? "huge" : `huge-${count}`);
    await heap(String(count));
  }
  result.incrementalSixMiB = result.heapsMiB.at(-1).heap - result.heapsMiB[0].heap;
  assert.ok(result.incrementalSixMiB <= 96, `six screens exceed 96MiB incremental heap: ${result.incrementalSixMiB}`);
  await open("huge", true);
  await sleep(10000);
  await open("huge-2", true);
  // A retained DOM bookmark must survive selection without a repair loop or storage restore.
  result.bookmarkBefore = await evaluate(cdp, `new Promise(resolve=>{
    const viewport=[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0);
    viewport.scrollTop=Math.max(0,viewport.scrollTop-650);
    requestAnimationFrame(()=>{
      const box=viewport.getBoundingClientRect();
      const node=[...viewport.querySelectorAll('[data-message-id]')].find(node=>{const r=node.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom;});
      window.__keptBookmark=node;
      resolve({id:node?.getAttribute('data-message-id'),y:node?.getBoundingClientRect().top-box.top,scrollTop:viewport.scrollTop});
    });
  })`);
  await open("huge", true);
  const bookmarkRequestStart=result.requests.length;
  result.bookmarkAfter = await evaluate(cdp, `new Promise(resolve=>{
    const click=performance.now();document.getElementById('picker-row-huge-2').click();
    requestAnimationFrame(()=>{
      const viewport=[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0);
      const box=viewport.getBoundingClientRect(),node=window.__keptBookmark;
      resolve({id:node?.getAttribute('data-message-id'),sameNode:node?.isConnected===true,y:node?.getBoundingClientRect().top-box.top,scrollTop:viewport.scrollTop,paintAt:performance.timeOrigin+performance.now(),ms:performance.now()-click});
    });
  })`);
  await sleep(100);
  result.bookmarkRequests=result.requests.slice(bookmarkRequestStart).filter(request=>request.at<=result.bookmarkAfter.paintAt);
  assert.equal(result.bookmarkAfter.id,result.bookmarkBefore.id);assert.ok(result.bookmarkAfter.sameNode);
  assert.ok(Math.abs(result.bookmarkAfter.y-result.bookmarkBefore.y)<=1,"kept bookmark moved more than one CSS pixel");assert.deepEqual(result.bookmarkRequests,[]);
  await evaluate(cdp, `(()=>{const v=[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0);v.scrollTop=v.scrollHeight;return true;})()`);
  await open("streaming", false, "Readable streaming last turn.");
  await open("huge-2", true);
  await streamingControl("complete");
  await sleep(100);
  await open("streaming", true, "Final reply completed while hidden.");
  assert.equal(result.hiddenCompletion.firstFrameHadFinal, true, "hidden completion must be final on the first frame");
  assert.equal(result.hiddenCompletion.finalFrame, 1, "hidden completion must not need a repair frame");
  result.finalReplyCount=await evaluate(cdp, `[...document.querySelectorAll('.transcript')].find(node=>node.getBoundingClientRect().width>0).textContent.split('Final reply completed while hidden.').length-1`);
  assert.equal(result.finalReplyCount,1,"hidden completion must be final and not duplicated");
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output.replace(/\.json$/u, ".png"), Buffer.from(screenshot.data, "base64"));
} catch (error) { result.failure = error.message; throw error; }
finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2));
  cdp?.close(); browser("close");
}
