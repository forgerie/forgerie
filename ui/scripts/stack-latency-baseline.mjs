#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Read-only browser navigation. Example:
// node ui/scripts/stack-latency-baseline.mjs /tmp/result.json http://127.0.0.1:8504/ ID_A,ID_B 1000 12 [paceMs=60]
// paceMs 0 reproduces the unpaced runner, which Chromium history throttling can censor.
// No network bodies, titles, transcript text, environment, or full URLs are saved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { CDP, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { destinationReady, paceDelay, routeLabel, summarize, SWITCH_PACE_MS } from "./stack-latency-contract.mjs";

async function main() {
  const [output, url, ids, count = "1000", coldCount = "12", pace = String(SWITCH_PACE_MS)] = process.argv.slice(2);
  const paceMs = Number(pace);
  paceDelay(undefined, 0, paceMs);
  assert.ok(output && url && ids, "output, URL and two comma-separated session IDs required");
  assert.ok(!existsSync(output), "Refusing to replace baseline evidence; choose a new output path");
  assert.equal(new URL(url).hostname, "127.0.0.1", "Only loopback measurement is allowed");
  const samples = Number(count), coldSamples = Number(coldCount);
  assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 5000);
  assert.ok(Number.isInteger(coldSamples) && coldSamples > 0 && coldSamples <= 100);
  const get = async path => {
    const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `HTTP ${response.status}`); return response.json();
  };
  const catalog = await get("/api/sessions/all");
  const targets = [];
  for (const id of ids.split(",")) {
    const session = catalog.sessions.find(session => session.id === id);
    assert.ok(session, "Requested session is absent");
    const open = await get(`/api/sessions/${encodeURIComponent(id)}/open?${new URLSearchParams({ cwd: session.cwd, limit: "50" })}`);
    assert.equal(open.status.isStreaming, false, "Use idle sessions for stable destination evidence");
    const last = open.page.messages.findLast(message => message.role === "assistant" && Array.isArray(message.content) && message.content.some(part => part.type === "text" && part.text.length >= 40));
    assert.ok(last, "No stable useful destination reply");
    const marker = last.content.filter(part => part.type === "text").map(part => part.text).join("").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 100);
    assert.ok(marker.length >= 30);
    targets.push({ id, title: session.name, marker, total: open.page.total, pageSize: open.page.messages.length, readPath: open.readPath });
  }
  assert.equal(targets.length, 2); assert.notEqual(targets[0].marker, targets[1].marker, "Replies must distinguish the destinations");
  const sessionName = `cefda578-latency-${process.pid}`;
  const browser = (...args) => execFileSync("agent-browser", ["--session", sessionName, ...args], { encoding: "utf8", timeout: 90000 });
  const result = { protocol: "destination-route-selection-and-API-reply/v2", startedAt: new Date().toISOString(), source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    viewport: "1440x900 DPR1 desktop emulation", syntheticClick: true, paint: "rAF-observed DOM then next-rAF opportunity; not compositor presentation timestamp", prefetchDisabled: true,
    cold: "browser store/document cold; asset cache warm after first navigation; daemon and OS cache uncontrolled", loadStart: loadavg(), paceMs, historyThrottleWarnings: [], cores: cpus().length,
    build: await get("/build.json"), boots: [], catalogSessions: catalog.sessions.length, histories: targets.map(({ total, pageSize, readPath }, target) => ({ target, total, pageSize, readPath })), opens: [] };
  let cdp;
  try {
    browser("open", "about:blank");
    const port = new URL(browser("get", "cdp-url").trim()).port;
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await CDP.connect(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await cdp.send("Page.enable"); await cdp.send("Performance.enable"); await cdp.send("Log.enable");
    // A throttled history update leaves the route behind the selection; record where it happened.
    cdp.listeners.set("Log.entryAdded", [({ entry }) => { if (/Throttling navigation/u.test(entry.text)) result.historyThrottleWarnings.push({ completedSamples: result.opens.length }); }]);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'},configurable:true});window.__longTasks=[];window.__observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(window.__longTasks.length<5000)window.__longTasks.push({start:e.startTime,duration:e.duration});});window.__observer.observe({type:'longtask',buffered:true});` });
    const ready = async expression => {
      const until = Date.now() + 30000;
      while (!(await evaluate(cdp, expression))) { assert.ok(Date.now() < until, "Browser readiness deadline exceeded"); await sleep(50); }
    };
    const navigate = async () => {
      await cdp.send("Page.navigate", { url });
      await ready(`navigator.connection.saveData===true && !!document.querySelector('.picker-group-header, [data-session]')`);
      // Old fixture dates legitimately live in collapsed age groups. Expose the
      // targets with the real controls, outside the timed interaction.
      await evaluate(cdp, `(()=>{for(const group of document.querySelectorAll('.picker-group-header[aria-expanded="false"]'))group.click();return true;})()`);
      await ready(`!!document.getElementById(${JSON.stringify(`picker-row-${targets[1].id}`)}) && !document.querySelector('.transcript')`);
      result.boots.push(await evaluate(cdp, `({catalogReadyObservedMs:performance.now(),longTasks:window.__longTasks,assets:performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname.startsWith('/assets/')).map(e=>({duration:e.duration,bytes:e.decodedBodySize,transfer:e.transferSize}))})`));
    };
    let lastClick;
    async function open(targetIndex, kind) {
      const target = targets[targetIndex];
      await sleep(paceDelay(lastClick, performance.now(), paceMs));
      lastClick = performance.now();
      const measured = await evaluate(cdp, `new Promise((resolve,reject)=>{
        const target=${JSON.stringify(target)}, destinationReady=${destinationReady.toString()};
        performance.clearResourceTimings();window.__longTasks=[];
        const click=performance.now();let firstFrameMs,acknowledgedOnFirstFrame=false,frames=0;
        document.getElementById('picker-row-'+target.id).click();
        const tick=()=>{frames++;if(frames===1){firstFrameMs=performance.now()-click;acknowledgedOnFirstFrame=document.getElementById('picker-row-'+target.id).getAttribute('aria-selected')==='true';}
          if(destinationReady(document,target)){const usefulFrameMs=performance.now()-click;requestAnimationFrame(()=>resolve({usefulFrameMs,paintOpportunityMs:performance.now()-click,firstFrameMs,acknowledgedOnFirstFrame,frames,
            longTasks:window.__longTasks.filter(e=>e.start>=click),resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=click).map(e=>({name:e.name,start:e.startTime-click,duration:e.duration,ttfb:e.responseStart-e.startTime,download:e.responseEnd-e.responseStart,bytes:e.decodedBodySize,transfer:e.transferSize}))}));}
          else if(performance.now()-click>20000){
            const visible=n=>!!n&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
            resolve({failed:true,diagnostic:{rowSelected:document.getElementById('picker-row-'+target.id)?.getAttribute('aria-selected')==='true',routeMatches:new URL(location.href).searchParams.get('session')===target.id,
              visibleShellCount:[...document.querySelectorAll('.session-shell')].filter(visible).length,
              shells:[...document.querySelectorAll('.session-shell')].filter(visible).map(shell=>{const t=shell.querySelector('.transcript'),c=shell.querySelector('[data-composer-input]');return {transcriptPresent:!!t,transcriptVisible:visible(t),composerPresent:!!c,composerVisible:visible(c),uniqueReplyMatch:[...shell.querySelectorAll('.message-text')].some(n=>n.textContent.toLowerCase().replace(/[^\\p{L}\\p{N}]/gu,'').includes(target.marker))};})}});
          }else requestAnimationFrame(tick);
        };requestAnimationFrame(tick);
      })`);
      if (measured.failed) {
        result.failedSample = { kind, target: targetIndex, completedSamples: result.opens.length, ...measured.diagnostic };
        throw new Error("Destination transcript not verified; failed sample excluded, see redacted diagnostic");
      }
      measured.resources = measured.resources.map(({ name, ...rest }) => ({ route: routeLabel(name), ...rest }));
      result.opens.push({ kind, target: targetIndex, ...measured });
    }
    for (let index = 0; index < coldSamples; index++) { await navigate(); await open(index % 2, "document-cold"); }
    await open(coldSamples % 2, "warm-seed");
    for (let index = 0; index < samples; index++) await open((index + coldSamples + 1) % 2, "warm-switch");
    result.summary = Object.fromEntries(["document-cold", "warm-switch"].map(kind => {
      const rows = result.opens.filter(row => row.kind === kind);
      return [kind, { usefulFrameMs: summarize(rows.map(row => row.usefulFrameMs)), paintOpportunityMs: summarize(rows.map(row => row.paintOpportunityMs)),
        missedFirstFrameAcknowledgements: rows.filter(row => !row.acknowledgedOnFirstFrame).length, longTasks: rows.flatMap(row => row.longTasks).length,
        maxLongTaskMs: Math.max(0, ...rows.flatMap(row => row.longTasks.map(task => task.duration))) }];
    }));
    result.browser = await cdp.send("Browser.getVersion");
  } catch (error) { result.failure = error.message; throw error; }
  finally {
    result.loadEnd = loadavg(); result.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(result, null, 2));
    cdp?.close(); browser("close");
  }
  process.stdout.write(JSON.stringify(result.summary, null, 2) + "\n");
}
await main();
