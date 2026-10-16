// Captures every scene at desktop and the four Fold 8 postures through CDP emulation.
// Usage: node shoot.mjs <light|dark> [scene ...]
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";
import { openPosturePage } from "../../scripts/lib/posture-page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [scheme = "light", ...only] = process.argv.slice(2);
const ALL = ["pr-empty", "pr-typed", "pr-error", "workflows", "workflows-filter", "decisions", "decisions-open", "decisions-overturn",
  "agents-problem", "agents-mixed", "processes-empty", "processes", "process-detail"];
const scenes = only.length ? only : ALL;
const sizes = [{ name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false }, ...FOLD8_POSTURES];

const temp = await mkdtemp(join(tmpdir(), "sheet-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN ?? findChrome(), port, join(temp, "profile"));
try {
  await waitForDebugger(port);
  await mkdir(join(here, "shots"), { recursive: true });
  for (const size of sizes) {
    const cdp = await openPosturePage({ debugPort: port, posture: size, colorScheme: scheme });
    if (size.dpr) await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.dpr, mobile: size.mobile });
    for (const scene of scenes) {
      const loaded = cdp.waitForEvent("Page.loadEventFired", 10000).catch(() => undefined);
      await cdp.send("Page.navigate", { url: `file://${here}/index.html?scene=${scene}&still` });
      await loaded;
      await sleep(400);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const out = join(here, "shots", `${scheme}-${scene}-${size.name}.png`);
      await writeFile(out, Buffer.from(data, "base64"));
      process.stdout.write(`${out}\n`);
    }
    cdp.close();
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  await rm(temp, { recursive: true, force: true });
}
