// Measures what an idle picker page costs the main thread over a few seconds.
// Read-only. Splits the busy time into script, style, layout, and paint so a
// render loop can be told from a CSS animation.
//   CHROME_BIN=... node scripts/idle-cost.mjs [url]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));

const url = process.argv[2] ?? "http://127.0.0.1:8510/";
const userDataDir = await mkdtemp(join(tmpdir(), "idle-cost-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN, port, userDataDir);
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  const frames = new Map();
  let counting = false;
  cdp.listeners.set("Network.webSocketFrameReceived", [({ response }) => {
    if (!counting) return;
    let type = "binary";
    try { type = JSON.parse(response.opcode === 2 ? Buffer.from(response.payloadData, "base64").toString() : response.payloadData).type; } catch { /* keep binary */ }
    frames.set(type, (frames.get(type) ?? 0) + 1);
  }]);
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(6000);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metrics();
  counting = true;
  await sleep(5000);
  counting = false;
  const after = await metrics();
  console.log("frames in 5 s", JSON.stringify(Object.fromEntries(frames)));
  const delta = (name) => Number((after[name] - before[name]).toFixed(3));
  const renders = await evaluate(cdp, `document.querySelectorAll(".picker-row").length`);
  console.log(JSON.stringify({ url, rows: renders, windowSeconds: 5, task: delta("TaskDuration"), script: delta("ScriptDuration"), style: delta("RecalcStyleDuration"), layout: delta("LayoutDuration"), styleCount: delta("RecalcStyleCount"), layoutCount: delta("LayoutCount"), nodes: after.Nodes }));
  cdp.close();
} finally {
  chrome.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
