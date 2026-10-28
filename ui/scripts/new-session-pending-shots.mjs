// Deterministic production-component captures. Uses CDP viewport emulation, not window sizing.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launchChrome, getFreePort, waitForDebugger, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { openPosturePage, drivePage } from "../../scripts/lib/posture-page.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";

const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const out = process.env.SHOT_DIR ?? "/tmp/forgerie-new-session-shots";
const profile = await mkdtemp(join(tmpdir(), "new-session-shots-"));
const debugPort = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN ?? findChrome(), debugPort, profile);
const results = [];
await mkdir(out, { recursive: true });
try {
  await waitForDebugger(debugPort);
  for (const scheme of ["light", "dark"]) {
    for (const posture of [...FOLD8_POSTURES, { name: "desktop", width: 1440, height: 900 }]) {
      for (const scenario of ["new-session", "new-session-destination", "new-session-failed-pending"]) {
        const cdp = await openPosturePage({ debugPort, posture, colorScheme: scheme });
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1, mobile: true });
        const errors = [];
        cdp.listeners.set("Runtime.exceptionThrown", [event => errors.push(event.exceptionDetails.text)]);
        try {
          const fixture = scenario === "new-session-destination" ? "new-session" : scenario;
          await drivePage(cdp, { url: `${origin}/verification/preview.html?scenario=${fixture}`, settle: 1500 });
          const until = async (expression) => {
            const deadline = Date.now() + 20000;
            while (!await evaluate(cdp, expression)) {
              if (Date.now() >= deadline) throw new Error(`Timed out: ${expression}`);
              await sleep(50);
            }
          };
          if (scenario === "new-session-destination") {
            await until("!!document.querySelector('.destination-trigger:not(:disabled)')");
            await evaluate(cdp, "document.querySelector('.destination-trigger').click()");
            await until("!!document.querySelector('[data-option-id=\"specific:p1\"]')");
            await evaluate(cdp, "document.querySelector('[data-option-id=\"specific:p1\"]').click()");
            await until("!!document.querySelector('[aria-label=\"Workspaces of forgerie\"] [data-option-id=\"w1\"]')");
          }
          if (scenario === "new-session-failed-pending") await until("document.querySelector('.session-shell')?.textContent.includes('Retry setup')");
          const geometry = await evaluate(cdp, `(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            open: !!document.querySelector('.ns-dialog[open]'),
            tray: !!document.querySelector('.ns-tray'),
            branches: !!document.querySelector('[aria-label="Workspaces of forgerie"]'),
            failed: document.querySelector('.session-shell')?.textContent.includes('Worktree setup failed'),
            restore: [...document.querySelectorAll('button')].some(node => node.textContent === 'Restore draft'),
            retry: [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry setup'),
          }))()`);
          assert.equal(geometry.overflow, false);
          assert.equal(geometry.tray, false);
          assert.deepEqual(errors, []);
          if (scenario === "new-session-failed-pending") {
            assert.equal(geometry.open, false); assert.equal(geometry.failed, true);
            assert.equal(geometry.restore, true); assert.equal(geometry.retry, true);
          } else {
            assert.equal(geometry.open, true);
            assert.equal(geometry.branches, scenario === "new-session-destination");
          }
          const path = join(out, `${scenario}-${posture.name}-${scheme}.png`);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          await writeFile(path, Buffer.from(data, "base64"));
          results.push({ path, width: posture.width, height: posture.height, ...geometry });
          console.log(path);
        } finally { cdp.close(); }
      }
    }
  }
  await writeFile(join(out, "geometry.json"), `${JSON.stringify(results, null, 2)}\n`);
} finally {
  chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
