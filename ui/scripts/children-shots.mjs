#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Captures preview scenarios at every Fold posture and both colour schemes.
// Run from ui/ with the dev server up:
//   APP_URL=http://127.0.0.1:8531/ scripts/children-shots.mjs children children-list children-child
// Each capture also reports page overflow and the focused element, which a sheet must not ring on open.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "/tmp/children-shots");
const base = process.env.APP_URL ?? "http://127.0.0.1:8531/";
const scenarios = process.argv.slice(2);
const schemes = (process.env.SCHEMES ?? "light,dark").split(",");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "children-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const facts = `(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  focused: document.activeElement === document.body ? "body" : (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.className ?? "?"),
  focusVisible: document.activeElement?.matches?.(":focus-visible") ?? false,
}))()`;
try {
  await waitForDebugger(port);
  for (const scenario of scenarios) {
    for (const colorScheme of schemes) {
      for (const posture of FOLD8_POSTURES) {
        const cdp = await openPosturePage({ debugPort: port, posture, colorScheme });
        await cdp.send("Page.navigate", { url: new URL(`/verification/preview.html?scenario=${scenario}`, base).href });
        const deadline = Date.now() + 10_000;
        while (!(await evaluate(cdp, `document.querySelector(".thread-root, .message, dialog[open]") !== null`))) {
          if (Date.now() > deadline) throw new Error(`Nothing rendered in ${scenario}`);
          await sleep(50);
        }
        await sleep(900);
        const result = await evaluate(cdp, facts);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${scenario}-${colorScheme}-${posture.name}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify(result));
        cdp.close();
      }
    }
  }
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}
