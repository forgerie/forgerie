#!/usr/bin/env node
// Captures the Fold 8 acceptance posture matrix from AGENTS.md against a
// running Forgerie instance, optionally after driving the UI (shadow-DOM aware).
//
//   node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ --out /tmp/shots --label slice2
//   node scripts/capture-postures.mjs --url ... --click-title Sessions --label overlay
//   node scripts/capture-postures.mjs --url ... --press ctrl+k --click-title "New Prompt"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CDP,
  evaluate,
  findChrome,
  getFreePort,
  launchChrome,
  openPage,
  sleep,
  waitForDebugger,
} from "./lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "./lib/fold8-postures.mjs";

export { FOLD8_POSTURES };

const DEEP_QUERY = `
  (() => {
    const walk = (root, test) => {
      for (const element of root.querySelectorAll("*")) {
        if (test(element)) return element;
        if (element.shadowRoot) {
          const found = walk(element.shadowRoot, test);
          if (found) return found;
        }
      }
      return undefined;
    };
    window.__forgerieDeepFind = (test) => walk(document, test);
  })()
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-postures-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  const captured = [];

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      const outputPath = join(args.out, `${args.label}-${posture.name}.png`);
      await capturePosture({ debugPort, posture, args, outputPath });
      captured.push(outputPath);
      process.stdout.write(`captured ${outputPath}\n`);
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }

  return captured;
}

async function capturePosture({ debugPort, posture, args, outputPath }) {
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
    // Emulate the OS preference rather than force-darkening rendered pixels:
    // the app's auto theme pair resolves from prefers-color-scheme, so this
    // exercises the real resolution path.
    if (args.colorScheme !== undefined) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: args.colorScheme }],
      });
    }

    const loaded = cdp.waitForEvent("Page.loadEventFired", args.timeout).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await loaded;
    await sleep(args.settle);

    // Headless Chromium sends a mouse pointer, so a capture cannot reach the
    // touch affordances on its own. Dispatching a real pointerdown with a
    // pointerType drives the app's own observer, rather than writing the
    // result the observer is supposed to produce.
    if (args.inputMode !== undefined) {
      const applied = await evaluate(cdp, `
        (() => {
          document.dispatchEvent(new PointerEvent("pointerdown", {
            pointerType: ${JSON.stringify(args.inputMode)},
            bubbles: true,
          }));
          return getComputedStyle(document.documentElement)
            .getPropertyValue("--pi-row-actions-display").trim();
        })()
      `);
      process.stdout.write(`  ${posture.name}: input=${args.inputMode} row-actions=${String(applied)}\n`);
      await sleep(300);
    }

    // Real key input through CDP, not a synthetic DOM event: surfaces opened
    // by a keyboard shortcut are reached the way the user reaches them.
    for (const combo of args.presses) {
      await pressCombo(cdp, combo);
      await sleep(args.settle);
    }

    // Repeated --click-title flags run in order, so a capture can walk a
    // short path (open the workspace sheet, then pick a tool tab).
    for (const clickTitle of args.clickTitles) {
      await evaluate(cdp, DEEP_QUERY);
      const clicked = await evaluate(cdp, `
        (() => {
          const target = window.__forgerieDeepFind((element) =>
            element.tagName === "BUTTON" && element.getAttribute("title") === ${JSON.stringify(clickTitle)});
          if (!target) return false;
          target.click();
          return true;
        })()
      `);
      if (clicked !== true) throw new Error(`No button titled ${JSON.stringify(clickTitle)} in ${posture.name}`);
      await sleep(args.settle);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(data, "base64"));
  } finally {
    cdp.close();
  }
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/forgerie-postures", label: "posture", settle: 4000, timeout: 20000, clickTitles: [], presses: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--click-title") parsed.clickTitles.push(argv[++i]);
    else if (arg === "--press") parsed.presses.push(argv[++i]);
    else if (arg === "--input-mode") parsed.inputMode = argv[++i];
    else if (arg === "--color-scheme") parsed.colorScheme = requireColorScheme(argv[++i]);
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

const CDP_MODIFIERS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

/** Dispatches a combo such as "ctrl+k" or "shift+meta+p" as real key input. */
async function pressCombo(cdp, combo) {
  const parts = combo.split("+").map((part) => part.trim().toLowerCase()).filter((part) => part !== "");
  const key = parts.pop();
  if (key === undefined) fail(`--press needs a key, got ${JSON.stringify(combo)}`);
  let modifiers = 0;
  for (const part of parts) {
    const bit = CDP_MODIFIERS[part];
    if (bit === undefined) fail(`Unknown modifier ${JSON.stringify(part)} in ${JSON.stringify(combo)}`);
    modifiers |= bit;
  }
  const base = { modifiers, key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

function requireColorScheme(value) {
  if (value === "dark" || value === "light") return value;
  fail(`--color-scheme must be dark or light, got ${JSON.stringify(value)}`);
  return undefined;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
