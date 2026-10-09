#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const out = process.env.SHOT_DIR ?? "/tmp/aui-skills-shots";
const chromium = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
for (const scenario of ["skills", "skills-open", "skills-invocation", "skills-running"]) {
  for (const scheme of ["light", "dark"]) {
    const result = spawnSync(process.execPath, [join(repo, "scripts/capture-postures.mjs"),
      "--url", `${origin}/verification/preview.html?scenario=${scenario}`,
      "--out", out, "--label", `${scenario}-${scheme}`, "--color-scheme", scheme, "--chrome-bin", chromium, "--settle", "1000"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Posture capture failed: ${scenario} ${scheme}`);
  }
}
