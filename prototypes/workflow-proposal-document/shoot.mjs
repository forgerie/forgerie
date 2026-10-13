#!/usr/bin/env node
// Screenshot the mockup part: the Review state at a ladder of viewport sizes,
// and every state at one wide and one narrow size.
// Usage: node shoot.mjs [origin] [scheme]
//   origin: the ui dev server with caliper(), default http://localhost:8510
//   scheme: light or dark, default light
// CHROMIUM names the browser; render.sh sets it.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../ui/package.json"));
const { chromium } = require("playwright-core");

const origin = process.argv[2] ?? "http://localhost:8510";
const scheme = process.argv[3] ?? "light";
const part = "src/workflows/proposalMockups/ProposalMockups.page.part.tsx";
const sizes = [
  ["desktop", 1440, 900],
  ["tablet", 1180, 820],
  ["fold-open-landscape", 932, 553],
  ["fold-open-portrait", 704, 783],
  ["fold-closed-portrait", 475, 638],
  ["fold-closed-landscape", 711, 374],
];
const states = ["AtAStage", "EditedInputs", "InputsOpen", "Reading", "ReadFailed", "AnotherRunActive", "Starting", "StartFailed",
  "AskForChanges", "ChangesSent", "Started", "Dismissed", "Replaced", "ProseOnly"];
const jobs = [
  ...sizes.map(([size, width, height]) => ({ state: "default", file: `size-${size}`, width, height })),
  ...states.flatMap((state) => [
    { state, file: `state-wide-${state}`, width: 1180, height: 820 },
    { state, file: `state-narrow-${state}`, width: 475, height: 638 },
  ]),
];

const out = join(here, "shots");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 2, colorScheme: scheme });
  await page.goto(`${origin}/__caliper/frame?part=${encodeURIComponent(part)}&state=${job.state}`);
  await page.waitForSelector(".pm-sheet[open]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const file = join(out, `${job.file}-${scheme}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await browser.close();
