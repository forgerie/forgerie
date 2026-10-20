#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Bounded controlled soak against a running native fixture (scripts/stack-latency-native.mjs).
// One browser lifetime and one fixture edge; the fixture daemon restarts in reconnect phases.
// Run it as a Forgerie managed process so it survives coordinator restarts. A lost
// run is never restarted automatically; its samples.jsonl stays for inspection.
// Watch lines: SOAK_PHASE, SOAK_FAILURE, SOAK_DONE, SOAK_REFUSED. Exit 0 only when
// every correctness check passed. No forced GC, heap snapshot, prompt or provider call.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { CDP, evaluate, sleep } from "./lib/cdp.mjs";
import { destinationReady, summarize } from "../ui/scripts/stack-latency-contract.mjs";
import { plateau, soakOptions, soakPhase, UNSUPPORTED_SOAK_PATHS } from "./stack-latency-soak-model.mjs";

const options = soakOptions(process.argv.slice(2));
const fixture = JSON.parse(await readFile(options.fixture, "utf8"));
assert.equal(new URL(fixture.origin).hostname, "127.0.0.1", "Only loopback fixtures");
assert.ok(fixture.sessions.length >= 2, "The soak needs at least two native sessions");
if (loadavg()[0] > options.maxStartLoad) {
  console.log(`SOAK_REFUSED load ${loadavg()[0].toFixed(2)} > ${options.maxStartLoad}`);
  process.exit(3);
}
await mkdir(options.output, { mode: 0o700 }); // Refuses an existing directory: evidence is never replaced.
const samplesFile = join(options.output, "samples.jsonl");
const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 100);
const targets = fixture.sessions.map(session => ({ id: session.id, marker: normalize(session.marker) }));
const counts = { switches: 0, censored: 0, draftChecks: 0, draftFailures: 0, reconnects: 0, reconnectFailures: 0 };
const failures = [];
const fail = (kind, detail) => { failures.push({ at: new Date().toISOString(), kind, detail }); console.log(`SOAK_FAILURE ${kind} ${detail}`); };

const name = `soak-${process.pid}`;
const browser = (...args) => execFileSync("agent-browser", ["--session", name, ...args], { encoding: "utf8", timeout: 90000 });
let cdp;
const started = performance.now();
const elapsedMin = () => (performance.now() - started) / 60000;
const metrics = async () => (await (await fetch(`${fixture.origin}/__fixtures/metrics`, { signal: AbortSignal.timeout(10000) })).json());
const vmRss = async pid => Number((await readFile(`/proc/${pid}/status`, "utf8")).match(/^VmRSS:\s+(\d+) kB/mu)?.[1] ?? Number.NaN) * 1024;

async function open(index) {
  const target = targets[index];
  const result = await evaluate(cdp, `new Promise(resolve=>{const target=${JSON.stringify(target)},destinationReady=${destinationReady.toString()};
    const click=performance.now();document.getElementById('picker-row-'+target.id)?.click();
    const tick=()=>{if(destinationReady(document,target))resolve({ms:performance.now()-click});else if(performance.now()-click>20000)resolve({failed:true});else requestAnimationFrame(tick);};requestAnimationFrame(tick);})`);
  counts.switches++;
  if (result.failed) { counts.censored++; fail("switch-readiness", `target ${index} not verified in 20 s`); }
  return result;
}

async function draftCheck(sequence) {
  counts.draftChecks++;
  const text = `soak draft ${sequence}`;
  await open(0);
  await evaluate(cdp, "(()=>{const input=document.querySelector('[data-composer-input]');input.focus();document.execCommand('selectAll');document.execCommand('delete');return true;})()");
  await cdp.send("Input.insertText", { text });
  await open(1); await open(0);
  const kept = await evaluate(cdp, "document.querySelector('[data-composer-input]')?.textContent ?? null");
  if (kept !== text) { counts.draftFailures++; fail("draft", `expected ${text.length} chars, found ${kept === null ? "no composer" : kept.length}`); }
  await evaluate(cdp, "(()=>{const input=document.querySelector('[data-composer-input]');input.focus();document.execCommand('selectAll');document.execCommand('delete');return true;})()");
}

async function reconnect() {
  counts.reconnects++;
  const before = (await metrics()).daemonPid;
  const begin = performance.now();
  const response = await fetch(`${fixture.origin}/__fixtures/restart-daemon`, { method: "POST", headers: { "x-fixture-token": fixture.token }, signal: AbortSignal.timeout(120000) });
  if (response.status !== 200 || (await metrics()).daemonPid === before) { counts.reconnectFailures++; fail("reconnect", `restart HTTP ${response.status}`); return null; }
  // Reconnection is proven by a fresh verified switch in each direction after the restart.
  const first = await open(1), second = await open(0);
  if (first.failed || second.failed) { counts.reconnectFailures++; return null; }
  return performance.now() - begin;
}

async function sample(phase, interval) {
  const page = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
  const edge = await metrics();
  const row = { at: new Date().toISOString(), elapsedMin: elapsedMin(), phase, load1: loadavg()[0],
    browserHeapUsed: page.JSHeapUsedSize, browserHeapTotal: page.JSHeapTotalSize, browserNodes: page.Nodes, browserListeners: page.JSEventListeners, browserDocuments: page.Documents,
    edgeRss: edge.memory.rss, edgeHeapUsed: edge.memory.heapUsed, daemonRss: await vmRss(edge.daemonPid),
    intervalSwitches: interval.switches.length, intervalSwitchMs: interval.switches.length === 0 ? null : summarize(interval.switches), reconnectMs: interval.reconnectMs,
    totals: { ...counts } };
  await appendFile(samplesFile, JSON.stringify(row) + "\n");
  return row;
}

const samples = [];
let exitCode = 1;
try {
  browser("open", "about:blank");
  const port = new URL(browser("get", "cdp-url").trim()).port;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.connect(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Performance.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'},configurable:true});" });
  await cdp.send("Page.navigate", { url: `${fixture.origin}/` });
  const deadline = Date.now() + 60000;
  while (!(await evaluate(cdp, `!!document.getElementById(${JSON.stringify(`picker-row-${targets[1].id}`)})`))) {
    await evaluate(cdp, "(()=>{for(const g of document.querySelectorAll('.picker-group-header[aria-expanded=\"false\"]'))g.click();return true;})()");
    assert.ok(Date.now() < deadline, "Fixture picker did not show the native sessions"); await sleep(250);
  }
  let phase, next = 0, sequence = 0, interval = { switches: [], reconnectMs: null };
  while (elapsedMin() < options.durationMin) {
    const current = soakPhase(elapsedMin(), options);
    if (current !== phase) {
      console.log(`SOAK_PHASE ${current} ${elapsedMin().toFixed(1)}min`);
      if (current === "reconnect") interval.reconnectMs = await reconnect();
      phase = current;
    }
    if (current === "warmup" || current === "load") {
      const result = await open(sequence++ % targets.length);
      if (!result.failed) interval.switches.push(result.ms);
      if (sequence % 25 === 0) await draftCheck(sequence);
      if (counts.censored > 20) throw new Error("More than 20 censored switches; stopping the soak");
    } else await sleep(1000);
    if (performance.now() >= next) {
      samples.push(await sample(current, interval));
      interval = { switches: [], reconnectMs: null };
      next = performance.now() + options.sampleSec * 1000;
    }
  }
  // Retained state after clean disposal: leave the app document, then sample once.
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(5000);
  const edge = await metrics();
  const disposed = { browserHeapUsed: Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])).JSHeapUsedSize,
    edgeRss: edge.memory.rss, edgeHeapUsed: edge.memory.heapUsed, daemonRss: await vmRss(edge.daemonPid) };
  const verdicts = ["browserHeapUsed", "browserNodes", "browserListeners", "edgeRss", "edgeHeapUsed", "daemonRss"].map(metric => plateau(samples, metric, options));
  const summary = { version: 1, options: { ...options, fixture: "redacted" }, cores: cpus().length, sessions: targets.length, counts, failures, verdicts, disposed,
    unsupported: UNSUPPORTED_SOAK_PATHS, notes: ["rising is not a leak verdict", "daemon heap is not observed; daemon RSS only", "no native streaming phase in this fixture"] };
  await writeFile(join(options.output, "summary.json"), JSON.stringify(summary, null, 2));
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(`SOAK_DONE ${join(options.output, "summary.json")} failures=${failures.length}`);
} catch (error) {
  fail("harness", error instanceof Error ? error.message : String(error));
  await writeFile(join(options.output, "failure.json"), JSON.stringify({ counts, failures, elapsedMin: elapsedMin() }, null, 2));
} finally {
  cdp?.close();
  try { browser("close"); } catch (error) { console.error(`agent-browser close failed: ${error.message}`); exitCode = 1; }
}
process.exit(exitCode);
