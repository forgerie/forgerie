#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Fold posture captures of the shell fixtures, through the canonical posture script.
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const out = process.env.SHOT_DIR ?? resolve("verification/local/shell-shots");
const chromium = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
const scenarios = [["history", "shell", ""], ["blocked", "shell-blocked", "!pwd"], ["agent", "shell-agent", "!!git status --short"]];
for (const [label, scenario, draft] of scenarios) {
  for (const scheme of ["light", "dark"]) {
    const url = `${origin}/verification/preview.html?scenario=${scenario}${draft ? `&draft=${encodeURIComponent(draft)}` : ""}`;
    const result = spawnSync(process.execPath, [join(repo, "scripts/capture-postures.mjs"), "--url", url,
      "--out", out, "--label", `${label}-${scheme}`, "--color-scheme", scheme, "--chrome-bin", chromium, "--settle", "1200"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Posture capture failed: ${label} ${scheme}`);
  }
}
