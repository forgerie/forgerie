#!/usr/bin/env node
// Captures the voice composer's frames at the Fold 8 postures.
//
// The dialog cannot be reached the way capture-postures.mjs reaches things: it
// needs a touch hold on the transcript and then a live microphone, and headless
// Chromium grants neither. So this mounts the element directly against the
// running app, with a speech capability whose audio and transcript are
// configured rather than recorded. Same seam the tests use.
//
//   node prototypes/voice-composer/capture.mjs --url http://127.0.0.1:8504/
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluate,
  findChrome,
  getFreePort,
  launchChrome,
  openPage,
  sleep,
  waitForDebugger,
} from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_PORTRAIT } from "../../scripts/lib/fold8-postures.mjs";

const POSTURES = [FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_PORTRAIT];
const SCHEMES = ["dark", "light"];

/** Mount the dialog in a named frame. Runs inside the page. */
const MOUNT = (frame) => `
  (() => {
    document.querySelectorAll("voice-composer-dialog").forEach((node) => node.remove());
    const dialog = document.createElement("voice-composer-dialog");
    const never = () => new Promise(() => undefined);
    dialog.capability = {
      getStatus: () => Promise.resolve({
        smartTurn: "unavailable", whisper: "ready", capability: "manual-only",
        limits: { sampleRateHz: 16000, maxTurnSeconds: 60, maxTurnBytes: 3840000, endpointWindowSeconds: 8, endpointWindowBytes: 512000 },
      }),
      createCaptureSession: (captureOptions) => {
        window.__voice = (seconds) => captureOptions.onSpeechActivity({
          startSample: 0, endSample: 16000 * seconds, sampleCount: 16000 * seconds,
        });
        return Promise.resolve({
          actualSampleRateHz: 16000, failure: undefined,
          endpointWindow: () => new Float32Array(), finalize: () => new Float32Array(),
          stopAndFinalize: never, abort: () => Promise.resolve(),
        });
      },
      speechApi: { checkTurn: never, transcribe: never },
    };
    dialog.ownerKey = "local:capture";
    dialog.onSendText = () => undefined;
    dialog.onDismiss = () => undefined;
    document.body.append(dialog);

    const frame = ${JSON.stringify(frame)};
    if (frame === "hearing") {
      // Report voiced audio the way the capture worklet does mid-sentence: one
      // sentence so far, then a steady trickle so the hearing window stays open.
      // A zero-sample report means silence and is ignored, which is the point.
      setTimeout(() => window.__voice?.(4), 120);
      setInterval(() => window.__voice?.(0.01), 100);
    }
    if (frame === "counting" || frame === "held") {
      const heard = Object.getPrototypeOf(dialog).heard;
      heard.call(dialog, "Pull the queued compaction indicator out of the composer and put it on the turn real instead");
      if (frame === "held") Object.getPrototypeOf(dialog).hold.call(dialog);
    }
    return true;
  })()
`;

async function main() {
  const url = argValue("--url") ?? "http://127.0.0.1:8504/";
  const out = argValue("--out") ?? new URL(".", import.meta.url).pathname;
  // `findChrome` shells out through `sh -lc`, which resets PATH inside a
  // `nix shell`, so an explicit binary wins when one is supplied.
  const chromeBin = argValue("--chrome-bin") ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) throw new Error("no chromium found; pass --chrome-bin or set CHROME_BIN");
  const port = await getFreePort();
  const userDataDir = await mkdtemp(join(tmpdir(), "voice-capture-"));
  const chrome = launchChrome(chromeBin, port, userDataDir);

  try {
    await waitForDebugger(port);
    for (const scheme of SCHEMES) {
      for (const posture of POSTURES) {
        for (const frame of ["listening", "hearing", "counting", "held"]) {
          await capture({ port, url, out, scheme, posture, frame });
        }
      }
    }
  } finally {
    chrome.kill();
    // Chromium keeps writing to its profile as it dies, so a failed cleanup
    // must not mask whatever actually went wrong above it.
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      .catch(() => undefined);
  }
}

async function capture({ port, url, out, scheme, posture, frame }) {
  const cdp = await openPage(port);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: posture.width, height: posture.height,
      deviceScaleFactor: FOLD8_DPR, mobile: true,
    });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });

    const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(3500);

    const mounted = await evaluate(cdp, MOUNT(frame));
    if (mounted !== true) throw new Error(`could not mount the dialog for ${frame}`);
    await sleep(600);

    const name = `${posture.name}-${scheme}-${frame}.png`;
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, name), Buffer.from(data, "base64"));
    process.stdout.write(`  ${name}\n`);
  } finally {
    cdp.close();
  }
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

await main();
