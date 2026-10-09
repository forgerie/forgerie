#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Fold 8 posture captures of the pull request preview, both color schemes. Network-free.
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const out = process.env.SHOT_DIR ?? "/tmp/aui-pr-shots";
const scenarios = (process.env.SCENARIOS ?? "failed,waiting,blocked,ready,watching,stopped,conflict,draft,merged,closed,loading,error,asked,header,rows").split(",");
const schemes = (process.env.SCHEMES ?? "light,dark").split(",");
const chromium = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
for (const scenario of scenarios) {
  for (const scheme of schemes) {
    const result = spawnSync(process.execPath, [join(repo, "scripts/capture-postures.mjs"),
      "--url", `${origin}/verification/pull-request-preview.html?scenario=${scenario}`,
      "--out", out, "--label", `${scenario}-${scheme}`, "--color-scheme", scheme, "--chrome-bin", chromium, "--settle", "1200"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Posture capture failed: ${scenario} ${scheme}`);
  }
}
