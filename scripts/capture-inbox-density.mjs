#!/usr/bin/env node
// Captures the shipped session inbox at both densities across the Fold 8
// posture matrix, against a running Forgerie instance. No injected styles: the
// density is set the way the settings panel sets it, in local storage, and the
// app is reloaded so it reads the choice at start-up.
//
//   node --experimental-strip-types scripts/capture-inbox-density.mjs \
//     --url http://127.0.0.1:8504/ --out /tmp/shots
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { INBOX_DENSITY_STORAGE_KEY } from "../src/client/src/inboxDensity.ts";

const DEEP_WALK = `
  window.__walk = (root, out) => {
    for (const element of root.querySelectorAll("*")) {
      out.push(element);
      if (element.shadowRoot) window.__walk(element.shadowRoot, out);
    }
    return out;
  };
  window.__inboxPanel = () => window.__walk(document, []).find((element) => element.tagName === "SESSION-INBOX-PANEL");
  "ready"
`;

function storeDensity(density) {
  return `
    (() => {
      localStorage.setItem(${JSON.stringify(INBOX_DENSITY_STORAGE_KEY)}, ${JSON.stringify(density)});
      return localStorage.getItem(${JSON.stringify(INBOX_DENSITY_STORAGE_KEY)});
    })()
  `;
}

function expandGroup(label) {
  return `
    (() => {
      const panel = window.__inboxPanel();
      if (!panel) return "no panel";
      const header = window.__walk(panel.shadowRoot, []).find((element) =>
        element.classList.contains("group-header") &&
        element.textContent.toUpperCase().includes(${JSON.stringify(label.toUpperCase())}));
      if (!header) return "no header";
      header.click();
      return "clicked";
    })()
  `;
}

/**
 * The compact shell reaches the inbox through the context bar's session chip,
 * and that chip only exists once a session is selected. On a fresh profile no
 * session is, so the empty state's recent list is used to pick one first.
 */
const SELECT_A_SESSION = `
  (() => {
    const chip = window.__walk(document, []).find((element) =>
      element.tagName === "BUTTON" && /open session selection/iu.test(element.getAttribute("aria-label") ?? ""));
    if (chip) return "already-selected";
    const recent = window.__walk(document, []).find((element) =>
      element.classList && element.classList.contains("empty-recent-row"));
    if (!recent) return "no-recent";
    recent.click();
    return "selected";
  })()
`;

/** Ask for the navigation sheet when the inbox is not already on screen. */
const OPEN_NAVIGATION = `
  (() => {
    const panel = window.__inboxPanel();
    if (panel && panel.getBoundingClientRect().width > 0) return "already-open";
    const opener = window.__walk(document, []).find((element) =>
      element.tagName === "BUTTON" && /open session selection/iu.test(element.getAttribute("aria-label") ?? ""));
    if (!opener) return "no-opener";
    opener.click();
    return "clicked";
  })()
`;

const MEASURE_AND_CLIP = `
  (() => {
    const panel = window.__inboxPanel();
    if (!panel) return { error: "no panel" };
    const rows = window.__walk(panel.shadowRoot, []).filter((element) => element.classList.contains("row"));
    const heights = rows.map((row) => Math.round(row.getBoundingClientRect().height)).filter((height) => height > 8);
    const shapes = [...new Set(rows.map((row) => row.getAttribute("data-shape")))];
    const rect = panel.getBoundingClientRect();
    return {
      rowCount: heights.length,
      shapes,
      distinctHeights: [...new Set(heights)].sort((a, b) => a - b),
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-inbox-shots-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  try {
    await waitForDebugger(debugPort);
    await mkdir(args.out, { recursive: true });
    for (const posture of FOLD8_POSTURES) {
      for (const density of args.densities) {
        await capture({ debugPort, posture, density, args });
      }
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function capture({ debugPort, posture, density, args }) {
  const cdp = await openPage(debugPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: posture.width,
      height: posture.height,
      deviceScaleFactor: FOLD8_DPR,
      mobile: true,
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: args.colorScheme }],
    });

    // Land on the origin first so local storage is writable for it, set the
    // choice, then reload so the app reads it the way a returning visit does.
    const firstLoad = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await firstLoad;
    await evaluate(cdp, storeDensity(density));
    const reload = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.reload", { ignoreCache: false });
    await reload;
    await sleep(args.settle);

    await evaluate(cdp, DEEP_WALK);

    // At the narrow postures the inbox is a sheet rather than a seated panel,
    // so it has to be asked for before there is anything to photograph.
    const selected = await evaluate(cdp, SELECT_A_SESSION);
    if (selected === "selected") await sleep(2500);
    const opened = await evaluate(cdp, OPEN_NAVIGATION);
    if (opened === "clicked") await sleep(1500);
    if (args.trace) process.stdout.write(`  ${posture.name} ${density}: select=${String(selected)} open=${String(opened)}\n`);

    for (const label of args.expandGroups) {
      await evaluate(cdp, expandGroup(label));
      await sleep(900);
    }

    const measured = await evaluate(cdp, MEASURE_AND_CLIP);
    if (measured.error !== undefined) {
      process.stdout.write(`${posture.name} ${density}: ${measured.error}\n`);
      return;
    }
    // In the sheet layout the panel host measures 0x0 while its rows lay out
    // normally, so a clip to it would ask for an empty screenshot. The sheet
    // fills the screen at those postures, so the viewport is the right frame.
    const clipped = measured.clip.width >= 1 && measured.clip.height >= 1;
    const outputPath = join(args.out, `${density}-${posture.name}.png`);
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      ...(clipped ? { clip: { ...measured.clip, scale: args.scale } } : {}),
    });
    await writeFile(outputPath, Buffer.from(data, "base64"));
    process.stdout.write(`${posture.name} ${density}: ${String(measured.rowCount)} rows, heights ${JSON.stringify(measured.distinctHeights)}, shapes ${JSON.stringify(measured.shapes)}${clipped ? "" : ", full viewport"} -> ${outputPath}\n`);
  } finally {
    cdp.close();
  }
}

function parseArgs(argv) {
  const parsed = {
    out: "/tmp/forgerie-inbox-shots",
    colorScheme: "dark",
    settle: 4500,
    scale: 2,
    expandGroups: ["OPEN"],
    densities: ["dense", "comfortable"],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--color-scheme") parsed.colorScheme = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else if (arg === "--scale") parsed.scale = Number(argv[++i]);
    else if (arg === "--trace") parsed.trace = true;
    else fail(`Unknown argument ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
