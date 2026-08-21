// Drives the running prototype through a scripted run and captures the moments
// that matter. Also fails loudly on any browser console error, so this doubles
// as the smoke test for the client.
//
// The server must already be running. Usage:
//   BASE=http://127.0.0.1:8789 node capture.mjs

import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CDP, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_LANDSCAPE } from "../../scripts/lib/fold8-postures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "shots");
const base = process.env["BASE"] ?? "http://127.0.0.1:8789";
const speed = process.env["SPEED"] ?? "2";
const variants = (process.env["VARIANTS"] ?? "follow,deck,ambient").split(",");

const MOMENTS = [
  { name: "work", posture: FOLD8_UNFOLDED_LANDSCAPE, until: undefined, waitMs: 5000 },
  { name: "decision", posture: FOLD8_FOLDED_PORTRAIT, until: "document.querySelector('.option') !== null" },
  { name: "answer", posture: FOLD8_FOLDED_PORTRAIT, until: "document.querySelector('.option') !== null", answer: true },
];

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) {
  process.stderr.write("Chromium not found. Set CHROME_BIN.\n");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const tempRoot = await mkdtemp(join(tmpdir(), "voice-content-"));
const debugPort = await getFreePort();
const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
const problems = [];

try {
  await waitForDebugger(debugPort);
  for (const variant of variants) {
    for (const moment of MOMENTS) {
      const cdp = await openPage(debugPort);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        collect(cdp, problems, `${variant}/${moment.name}`);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: moment.posture.width,
          height: moment.posture.height,
          deviceScaleFactor: FOLD8_DPR,
          mobile: true,
        });
        const url = `${base}/?variant=${variant}&session=reconnect&mute&nomic&bare&autostart&speed=${speed}`;
        const loaded = cdp.waitForEvent("Page.loadEventFired", 15000).catch(() => undefined);
        await cdp.send("Page.navigate", { url });
        await loaded;
        if (typeof moment.until === "string") await waitFor(cdp, moment.until, 60000);
        else await sleep(moment.waitMs ?? 4000);
        if (moment.answer === true) {
          await waitFor(cdp, "document.querySelector('.option') !== null", 60000);
          await evaluateIn(cdp, "document.querySelector('.option').click(); true");
          await waitFor(cdp, "document.body.innerText.includes('survives sleep')", 60000);
          await sleep(800);
        }
        await sleep(500);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        const file = join(outDir, `${variant}-${moment.name}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        process.stdout.write(`wrote ${variant}-${moment.name}.png (${moment.posture.width}x${moment.posture.height})\n`);
      } catch (error) {
        problems.push(`${variant}/${moment.name}: ${String(error?.message ?? error)}`);
      } finally {
        cdp.close();
      }
    }
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}

if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n${problems.map((line) => `  ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("no console errors\n");

function collect(cdp, sink, label) {
  push(cdp, "Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error" && params.type !== "warning") return;
    sink.push(`${label}: console.${params.type}: ${params.args.map(describe).join(" ")}`);
  });
  push(cdp, "Runtime.exceptionThrown", (params) => {
    sink.push(`${label}: uncaught: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`);
  });
}

function push(cdp, method, listener) {
  cdp.listeners.set(method, [...(cdp.listeners.get(method) ?? []), listener]);
}

function describe(argument) {
  return argument.value ?? argument.description ?? argument.unserializableValue ?? "?";
}

async function evaluateIn(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails !== undefined) {
    throw new Error(`evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
  }
  return response.result?.value;
}

async function waitFor(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await evaluateIn(cdp, expression)) === true) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${expression}`);
}
