#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Controlled event fixture only: no live daemon, profile, tools, or provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { CDP, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { matchTokenPaints, summarize } from "./stack-latency-contract.mjs";

async function main() {
  const [output, origin = "http://127.0.0.1:18641"] = process.argv.slice(2);
  assert.ok(output); assert.equal(origin, "http://127.0.0.1:18641", "This command is restricted to the isolated fixture port");
  const control = async action => { const response = await fetch(`${origin}/__fixtures/streaming/${action}`, { method: "POST" }); assert.ok(response.ok); };
  await control("reset");
  const name = `cefda578-input-${process.pid}`;
  const browser = (...args) => execFileSync("agent-browser", ["--session", name, ...args], { encoding: "utf8", timeout: 90000 });
  const result = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), fixture: "scripts/fast-chat-open-server.mjs, timer delta '.', classic event hub; no provider or storage", startedAt: new Date().toISOString(), loadStart: loadavg(), typing: [], streamingReceived: [], completion: null };
  let cdp;
  try {
    browser("open", "about:blank");
    const port = new URL(browser("get", "cdp-url").trim()).port;
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await CDP.connect(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await cdp.send("Page.enable"); await cdp.send("Network.enable"); await cdp.send("Performance.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true});` });
    await cdp.send("Page.navigate", { url: `${origin}/?session=streaming` });
    const until = async expression => { const end = Date.now() + 30000; while (!(await evaluate(cdp, expression))) { assert.ok(Date.now() < end, "Fixture deadline"); await sleep(50); } };
    await until(`document.querySelector('.transcript')?.textContent.includes('Readable streaming last turn.') && !!document.querySelector('[data-composer-input]')`);
    const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
    cdp.listeners.set("Network.webSocketFrameReceived", [event => {
      try { const payload = JSON.parse(event.response.payloadData); if (payload.type === "assistant.delta" && payload.text === "." && result.streamingReceived.length < 100) result.streamingReceived.push({ seq: payload.seq, at: (event.timestamp - metrics.NavigationStart) * 1000 }); }
      catch { /* Chunk/control frames are not token samples. No payload is retained. */ }
    }]);
    await evaluate(cdp, `(()=>{
      window.__streamPaints=[];window.__inputTimes=[];
      const node=[...document.querySelectorAll('.transcript .message-text')].find(n=>n.textContent.includes('Readable streaming last turn.'));
      // Markdown/diagram hydration changes other text in this same assistant
      // message. Count only the fixture's exact appended-dot suffix.
      const dots=()=>node.textContent.match(/Readable streaming last turn\\. Working on the deterministic fixture\\.(\\.*)/u)?.[1].length;
      window.__initialLength=dots();window.__streamStart=performance.now();let last=dots();
      window.__streamObserver=new MutationObserver(()=>{const length=dots();if(length===undefined||length===last)return;last=length;const observed=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(window.__streamPaints.length<100)window.__streamPaints.push({length,observed,paintOpportunity:performance.now()});}));});
      window.__streamObserver.observe(node,{subtree:true,childList:true,characterData:true});
      const input=document.querySelector('[data-composer-input]');input.focus();input.addEventListener('input',()=>{const eventAt=performance.now();requestAnimationFrame(()=>{const firstFrameMs=performance.now()-eventAt;const charsOnFirstFrame=input.textContent.length;requestAnimationFrame(()=>window.__inputTimes.push({eventAt,firstFrameMs,charsOnFirstFrame,paintOpportunityMs:performance.now()-eventAt}));});});return true;
    })()`);
    for (let index = 0; index < 200; index++) {
      await cdp.send("Input.insertText", { text: "x" });
      await until(`window.__inputTimes.length===${index + 1}`);
    }
    await until(`window.__streamPaints.length>=20`);
    result.typing = await evaluate(cdp, "window.__inputTimes");
    result.streamingPaints = await evaluate(cdp, "window.__streamPaints");
    result.initialLength = await evaluate(cdp, "window.__initialLength");
    result.streamStart = await evaluate(cdp, "window.__streamStart");
    result.streamingReceived = result.streamingReceived.filter(event => event.at >= result.streamStart);
    result.streamLengthUnit = "dots after the exact fixture reply, excluding other markdown/diagram hydration";
    result.draftChars = await evaluate(cdp, "document.querySelector('[data-composer-input]').textContent.length");
    assert.equal(result.draftChars, 200, "All inserted text must survive");
    await evaluate(cdp, "window.__completionStart=performance.now();true");
    await control("complete");
    result.completion = await evaluate(cdp, `new Promise((resolve,reject)=>{const tick=()=>{const t=[...document.querySelectorAll('.transcript')].find(n=>n.getBoundingClientRect().width>0);const count=t?.textContent.split('Final reply completed while hidden.').length-1;if(count===1)requestAnimationFrame(()=>resolve({ms:performance.now()-window.__completionStart,copies:count}));else if(performance.now()-window.__completionStart>10000)reject(new Error('Missing final reply'));else requestAnimationFrame(tick);};requestAnimationFrame(tick);})`);
    assert.ok(result.typing.every((row, index) => row.charsOnFirstFrame === index + 1), "Every input must be present at the first observed frame");
    result.typingSummary = summarize(result.typing.map(row => row.paintOpportunityMs));
    result.typingFirstFrameSummary = summarize(result.typing.map(row => row.firstFrameMs));
    const matched = matchTokenPaints(result.streamingReceived, result.streamingPaints, result.initialLength);
    result.streaming = matched; result.streamingSummary = summarize(matched.map(row => row.receiveToPaintOpportunityMs));
    await evaluate(cdp, "window.__streamObserver.disconnect();true");
  } catch (error) { result.failure = error.message; throw error; }
  finally { result.loadEnd = loadavg(); result.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(result, null, 2)); cdp?.close(); browser("close"); }
  process.stdout.write(JSON.stringify({ typing: result.typingSummary, streaming: result.streamingSummary, completion: result.completion }, null, 2) + "\n");
}
await main();
