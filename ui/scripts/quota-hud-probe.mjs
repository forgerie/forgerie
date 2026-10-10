#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Probe the Quota HUD mockup at one Fold posture: load a query, run one
// expression in the page, print the JSON result. Run from the checkout root:
//   ui/scripts/quota-hud-probe.mjs "state=sheet&variant=tiles" "document.title" [posture] [scheme]
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { evaluate, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";
import { openPosturePage } from "../../scripts/lib/posture-page.mjs";

const [query = "state=sheet", expression = "document.title", postureName = "unfolded-portrait", scheme = "dark"] = process.argv.slice(2);
const posture = FOLD8_POSTURES.find((candidate) => candidate.name === postureName);
if (!posture) throw new Error(`Unknown posture ${postureName}`);
const app = process.env.APP_URL ?? "http://127.0.0.1:8561/";
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN ?? execSync("command -v chromium").toString().trim(), port, await mkdtemp(join(tmpdir(), "quota-probe-")));
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
  await cdp.send("Page.navigate", { url: `${app}verification/quota-hud-mockup.html?${query}` });
  await sleep(2000);
  console.log(JSON.stringify(await evaluate(cdp, expression), null, 2));
  cdp.close?.();
} finally {
  chrome.kill();
}
