#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
for (const [name, scenario, mention] of [["files", "mentions", "@src"], ["models", "mentions", "#model"], ["ask", "mentions-ask", "@src"]]) {
  for (const scheme of ["light", "dark"]) {
    const url = new URL("/verification/preview.html", base);
    url.searchParams.set("scenario", scenario); url.searchParams.set("mention", mention);
    const capture = spawnSync("node", [join(repo, "scripts/capture-postures.mjs"), "--url", url.href,
      "--out", "verification/local/mentions-shots", "--label", `${name}-${scheme}`, "--color-scheme", scheme, "--settle", "800"], { stdio: "inherit" });
    if (capture.status !== 0) process.exit(capture.status ?? 1);
  }
}
