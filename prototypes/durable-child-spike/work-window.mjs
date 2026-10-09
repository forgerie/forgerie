#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// A controlled interruption window for the real-sessiond acceptance test.
import { appendFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const [marker, seconds] = process.argv.slice(2);
if (!marker || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) throw new Error("Usage: work-window.mjs marker seconds");
await appendFile(marker, "ready\n", "utf8");
await sleep(Number(seconds) * 1000);
