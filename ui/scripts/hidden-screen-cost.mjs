#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// One hidden streaming screen and one visible idle screen, through the real store.
// Counts React work and CDP scripting time during 20 fixture deltas. Run serially.
// CHROME_BIN=... ./ui/scripts/hidden-screen-cost.mjs <vite-url> <out.json> <fixture-url>
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CDP, evaluate, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";

const [base = "http://127.0.0.1:18650/", output = "/tmp/hidden-screen-cost.json", fixtureUrl = base] = process.argv.slice(2);
async function streamingControl(action) {
  const response = await fetch(new URL(`/__fixtures/streaming/${action}`, fixtureUrl), { method: "POST" });
  assert.ok(response.ok);
  const value = await response.json();
  assert.equal(value[action === "reset" ? "reset" : "completed"], true);
}
const chromeBin = process.env.CHROME_BIN;
assert.ok(chromeBin, "Set CHROME_BIN");
const profile = await mkdtemp(join(tmpdir(), "hidden-screen-cost-"));
const chrome = launchChrome(chromeBin, 18669, profile);
const result = { base, deltas: 0, requests: [] };
let cdp;
try {
  await streamingControl("reset");
  await waitForDebugger(18669);
  const target = await (await fetch("http://127.0.0.1:18669/json/new?about:blank", { method: "PUT" })).json();
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Network.enable"); await cdp.send("Performance.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    Object.defineProperty(navigator, 'connection', {value:{saveData:true,effectiveType:'4g'},configurable:true});
    window.__cost={active:false,commits:0,updates:{}};
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),
      inject(r){this.renderers.set(1,r);return 1;},onCommitFiberRoot(_id,root){
        const s=window.__cost;if(!s.active)return;s.commits++;
        const visit=(fiber)=>{for(let f=fiber;f;f=f.sibling){
          const prev=f.alternate;
          if([0,1,11,15].includes(f.tag)&&(f.flags&1)!==0){
            const name=f.type?.name||f.type?.render?.name||'anonymous';s.updates[name]=(s.updates[name]||0)+1;
          }
          if(f.child&&(!prev||f.child!==prev.child))visit(f.child);
        }};visit(root.current.child);
      },onCommitFiberUnmount(){},onPostCommitFiberRoot(){},onScheduleFiberRoot(){},setStrictMode(){},checkDCE(){}};
  ` });
  const until = async (expression) => {
    for (let i = 0; i < 600; i++) { if (await evaluate(cdp, expression)) return; await sleep(50); }
    throw new Error(`Timed out: ${expression}`);
  };
  await cdp.send("Page.navigate", { url: base });
  await until(`!!document.getElementById('picker-row-streaming')`);
  await evaluate(cdp, `document.getElementById('picker-row-streaming').click()`);
  await until(`document.querySelector('.transcript')?.textContent.includes('Readable streaming last turn.')`);
  await sleep(2000);
  await evaluate(cdp, `document.getElementById('picker-row-huge').click()`);
  await until(`[...document.querySelectorAll('.transcript')].some(v=>v.getBoundingClientRect().width>0&&v.textContent.includes('Readable last turn 1500.'))`);
  await sleep(2000);
  cdp.listeners.set("Network.webSocketFrameReceived", [event => {
    if (JSON.parse(event.response.payloadData).type === "assistant.delta") result.deltas++;
  }]);
  cdp.listeners.set("Network.requestWillBeSent", [event => {
    if (event.request.url.includes("/api/")) result.requests.push(new URL(event.request.url).pathname);
  }]);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  await evaluate(cdp, `window.__cost.active=true`);
  const deadline = Date.now() + 45000;
  while (result.deltas < 20 && Date.now() < deadline) await sleep(50);
  assert.ok(result.deltas >= 20, `Only ${result.deltas} fixture deltas arrived`);
  await sleep(200);
  await evaluate(cdp, `window.__cost.active=false`);
  const after = await metrics();
  result.react = await evaluate(cdp, `window.__cost`);
  result.scriptMs = (after.ScriptDuration - before.ScriptDuration) * 1000;
  result.taskMs = (after.TaskDuration - before.TaskDuration) * 1000;
  result.scriptMsPerDelta = result.scriptMs / result.deltas;
  result.taskMsPerDelta = result.taskMs / result.deltas;
  result.bindingRendersPerDelta = (result.react.updates.ForgerieSession ?? 0) / result.deltas;
  cdp.listeners.delete("Network.webSocketFrameReceived");
  cdp.listeners.delete("Network.requestWillBeSent");
  await streamingControl("complete");
  await sleep(300);
  result.completion = await evaluate(cdp, `new Promise(resolve=>{
    document.getElementById('picker-row-streaming').click();let frames=0;const samples=[];
    const tick=()=>{frames++;const v=[...document.querySelectorAll('.transcript')].find(v=>v.getBoundingClientRect().width>0);
      const m=[...v?.querySelectorAll('.message-text')??[]].find(m=>m.textContent.includes('Final reply completed while hidden.'));
      const b=v?.getBoundingClientRect(),r=m?.getBoundingClientRect();
      const visible=!!(b&&r&&r.width>0&&r.bottom>b.top&&r.top<b.bottom);
      samples.push({frame:frames,hasFinal:!!m,visible,scrollTop:v?.scrollTop,finalY:r?.top,viewportTop:b?.top});
      if(visible||frames===120)resolve(samples);else requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  })`);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output.replace(/\.json$/u, ".png"), Buffer.from(screenshot.data, "base64"));
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2));
  cdp?.close(); chrome.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
