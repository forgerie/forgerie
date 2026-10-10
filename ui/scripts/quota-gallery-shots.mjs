#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Full-page captures of the Quota marks gallery, one per subject, Fold
// posture and scheme. Run from the checkout root with the ui dev server up:
//   APP_URL=http://127.0.0.1:8561/ ui/scripts/quota-gallery-shots.mjs
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";
import { openPosturePage } from "../../scripts/lib/posture-page.mjs";

const app = process.env.APP_URL ?? "http://127.0.0.1:8561/";
const out = process.env.OUT ?? "ui/verification/local/quota-hud";
const postures = (process.env.POSTURES ?? "unfolded-portrait,folded-portrait").split(",");
await mkdir(out, { recursive: true });
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN ?? execSync("command -v chromium").toString().trim(), port, await mkdtemp(join(tmpdir(), "quota-gallery-")));
try {
  await waitForDebugger(port);
  for (const subject of ["pool", "balance"]) for (const scheme of ["dark", "light"]) for (const name of postures) {
    const posture = FOLD8_POSTURES.find((candidate) => candidate.name === name);
    const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
    await cdp.send("Page.navigate", { url: `${app}verification/quota-hud-mockup.html?state=gallery&subject=${subject}` });
    await sleep(1500);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = join(out, `gallery-${subject}-${scheme}-${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(file);
    cdp.close?.();
  }
} finally {
  chrome.kill();
}
