// Read-only picker acceptance against the live dev server (8510 -> 8504).
// Opens the app at a Fold posture, picks two sessions from the picker, and
// checks that the thread switches in place, the URL follows, Back returns to
// the first session, and the draft of the first session is not sent anywhere.
// It never types into a composer and never clicks Send or Stop.
//   CHROME_BIN=... node scripts/picker-acceptance.mjs
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));

const base = process.env.PICKER_URL ?? "http://127.0.0.1:8510/";
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin) throw new Error("Set CHROME_BIN");
const out = "verification/local/picker";
await mkdir(out, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "picker-accept-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, userDataDir);
const results = [];
const mutations = [];
try {
  await waitForDebugger(port);
  for (const posture of FOLD8_POSTURES) {
    const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: "dark" });
    await cdp.send("Network.enable");
    const errors = [];
    cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.text)]);
    cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
      if (request.method !== "GET" && new URL(request.url).pathname.startsWith("/api/")) mutations.push(`${posture.name} ${request.method} ${new URL(request.url).pathname}`);
    }]);
    const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url: base });
    await loaded;
    const ready = async (predicate, what) => {
      for (let i = 0; i < 60; i += 1) { if (await evaluate(cdp, predicate)) return; await sleep(250); }
      throw new Error(`${posture.name}: ${what} never happened`);
    };
    await ready(`document.querySelectorAll(".picker-row").length > 0`, "picker rows");
    const initial = await evaluate(cdp, `({ layout: document.querySelector(".app-shell")?.dataset.layout, sheet: document.querySelector(".app-shell")?.dataset.sheet, rows: document.querySelectorAll(".picker-row").length, overflow: document.documentElement.scrollWidth > innerWidth })`);
    // Pick the second and third visible named rows, so the test does not depend on one session.
    const ids = await evaluate(cdp, `[...document.querySelectorAll(".picker-row")].filter((row) => !row.querySelector(".picker-untitled")).slice(1, 3).map((row) => row.dataset.session)`);
    const [first, second] = ids;
    const open = async (id) => {
      await evaluate(cdp, `(document.querySelector(".app-opener")?.getAttribute("aria-expanded") === "false" && document.querySelector(".app-opener").click(), true)`);
      await ready(`document.querySelector(".app-shell")?.dataset.sheet === "open"`, "sheet open");
      await evaluate(cdp, `document.querySelector('[data-session="${id}"]').click()`);
      await ready(`new URLSearchParams(location.search).get("session") === "${id}" && document.querySelector(".app-shell")?.dataset.sheet === "closed"`, `open ${id}`);
      await ready(`!!document.querySelector(".session-title") && document.querySelector(".session-title").textContent !== "No session open"`, "thread header");
      return evaluate(cdp, `({ title: document.querySelector(".session-title")?.textContent, status: document.querySelector(".connection-status")?.textContent })`);
    };
    const rowTitle = (id) => evaluate(cdp, `document.querySelector('[data-session="${id}"] .picker-title')?.textContent?.trim()`);
    const firstTitle = await rowTitle(first);
    const secondTitle = await rowTitle(second);
    const firstThread = await open(first);
    const secondThread = await open(second);
    await evaluate(cdp, "history.back()");
    await ready(`new URLSearchParams(location.search).get("session") === "${first}"`, "back to first");
    await ready(`document.querySelector(".session-title")?.textContent === ${JSON.stringify(firstThread.title)}`, "first thread again");
    const selectedAfterBack = await evaluate(cdp, `document.querySelector('.picker-row[aria-selected="true"]')?.dataset.session`);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(out, `${posture.name}.png`), Buffer.from(data, "base64"));
    results.push({ posture: posture.name, initial, first, second, firstThread, firstTitle, secondThread, secondTitle, selectedAfterBack, errors });
    cdp.close();
  }
} finally {
  chrome.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
const failures = results.flatMap((r) => [
  r.initial.layout !== "overlay" && `${r.posture}: layout ${r.initial.layout}, expected overlay`,
  r.initial.sheet !== "open" && `${r.posture}: sheet not open with nothing selected`,
  r.initial.overflow && `${r.posture}: page overflows horizontally`,
  r.firstThread.title !== r.firstTitle && `${r.posture}: first thread titled ${JSON.stringify(r.firstThread.title)}, row says ${JSON.stringify(r.firstTitle)}`,
  r.secondThread.title !== r.secondTitle && `${r.posture}: second thread titled ${JSON.stringify(r.secondThread.title)}, row says ${JSON.stringify(r.secondTitle)}`,
  r.selectedAfterBack !== r.first && `${r.posture}: Back did not reselect the first row`,
  r.errors.length > 0 && `${r.posture}: page exceptions ${r.errors.join("; ")}`,
].filter(Boolean));
if (mutations.length) failures.push(`non-GET requests: ${mutations.join(", ")}`);
await writeFile(join(out, "result.json"), JSON.stringify({ results, mutations, failures }, null, 2));
console.log(JSON.stringify({ results: results.map((r) => ({ posture: r.posture, layout: r.initial.layout, rows: r.initial.rows, first: r.firstThread.title, second: r.secondThread.title, back: r.selectedAfterBack === r.first })), failures }, null, 1));
process.exit(failures.length ? 1 : 0);
