#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium --command node
// Start the browser app's Vite dev server for the Caliper app (~/.agents/skills/caliper-parts/SETUP.md).
// Caliper needs Node 24, CHROMIUM for renders and checks, and XDG_RUNTIME_DIR so that the app finds
// the server in its registry. Each worktree is its own Caliper project. Vite picks a free port.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "vite";

process.env.CHROMIUM ||= execSync("command -v chromium").toString().trim();
const runtimeDir = `/run/user/${process.getuid()}`;
if (!process.env.XDG_RUNTIME_DIR && existsSync(runtimeDir)) process.env.XDG_RUNTIME_DIR = runtimeDir;

const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { strictPort: false } });
await server.listen();
server.printUrls();
