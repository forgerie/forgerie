#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [packageRoot, agentDir] = process.argv.slice(2);
if (packageRoot === undefined || agentDir === undefined) {
  throw new Error("Installed package root and isolated profile directory are required");
}
assert.equal(process.env["PI_CODING_AGENT_DIR"], agentDir);
assert.equal(process.env["PI_OFFLINE"], "1");
await mkdir(agentDir, { recursive: true });
const credentials = JSON.stringify({ anthropic: { type: "api_key", key: "package-smoke-test-key" } });
const authPath = join(agentDir, "auth.json");
await writeFile(authPath, credentials);
const { createModelRuntimeForAgentDir } = await import(pathToFileURL(join(packageRoot, "dist/server/sessions/modelRuntime.js")).href);
const runtime = await createModelRuntimeForAgentDir(agentDir);
assert.equal(runtime.hasConfiguredAuth("anthropic"), true);
assert.equal(await readFile(authPath, "utf8"), credentials);
console.log("Installed model runtime loaded isolated stored credentials without changing them.");
