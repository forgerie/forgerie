#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in network acceptance. Owns only a temporary profile and hosted runtime.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { DurableSessionRuntime } from "../src/server/sessions/durableSessionRuntime.js";
import type { DurableAgentSession } from "../src/server/sessions/durableAgentSession.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { bundledWebAccessPackagePath } from "../src/server/sessions/bundledWebAccess.js";

if (process.env.WEB_ACCESS_REAL !== "1") throw new Error("Set WEB_ACCESS_REAL=1 to authorize network acceptance");
const root = await mkdtemp(join(tmpdir(), "forgerie-web-access-real-"));
const agentDir = join(root, "agent");
const cwd = join(root, "workspace");
const bin = join(root, "bin");
const browserMarker = join(root, "browser-attempted");
await Promise.all([mkdir(agentDir, { mode: 0o700 }), mkdir(cwd), mkdir(bin)]);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.HOME = root;
process.env.PI_WEB_ACCESS_CACHE_ROOT = agentDir;
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
// Remove provider credentials without reading or reporting their values.
for (const name of Object.keys(process.env)) {
  if (/(?:API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN)$/u.test(name) || name === "GOOGLE_APPLICATION_CREDENTIALS") delete process.env[name];
}
await writeFile(join(bin, "xdg-open"), `#!/usr/bin/env -S nix shell nixpkgs#bash -c bash\nprintf attempted > '${browserMarker}'\nexit 1\n`, { mode: 0o700 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], compaction: { enabled: false } }));
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
let hosted: DurableAgentSession | undefined;
const service = new PiSessionService(new SessionEventHub(), {
  agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  // Observe the real default factory, not an alternative loader or tool registry.
  createAgentRuntime: async (factory, options) => {
    assert.ok(options.sessionManager instanceof SessionManager);
    return DurableSessionRuntime.open(async (runtimeOptions) => {
      const runtime = await factory({ ...runtimeOptions, delegationToolsEnabled: options.delegationToolsEnabled, scopedModels: options.scopedModels });
      hosted = runtime.session;
      return runtime;
    }, { cwd: options.cwd, agentDir: options.agentDir, sessionManager: options.sessionManager });
  },
});
try {
  await service.start(cwd);
  assert.ok(hosted);
  const loaded = hosted.resourceLoader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const owner = loaded.extensions.find((extension) => extension.tools.has("web_search"));
  assert.equal(owner?.path, join(bundledWebAccessPackagePath(), "dist", "index.js"));
  for (const name of ["web_search", "fetch_content", "get_search_content", "source_check"]) assert.ok(owner?.tools.has(name));
  const tools = hosted.extensionRunner.createToolContext("web-access-acceptance", undefined);
  const signal = AbortSignal.timeout(120000);
  const startedSearch = performance.now();
  const search = await tools.executeTool("web_search", { queries: ["Node.js official documentation"], numResults: 3 }, { signal });
  const searchMs = Math.round(performance.now() - startedSearch);
  assert.equal(search.isError, false, "web_search failed");
  const SearchDetails = Type.Object({ successfulQueries: Type.Number(), totalResults: Type.Number(), queryProviders: Type.Array(Type.Object({ providers: Type.Array(Type.String()) })) });
  const details = search.result.details;
  assert.ok(Check(SearchDetails, details), "Search returned unexpected details");
  assert.equal(details.successfulQueries, 1, "Keyless query failed");
  assert.ok(details.totalResults > 0);
  assert.deepEqual(details.queryProviders[0]?.providers, ["exa"]);
  const startedFetch = performance.now();
  const fetch = await tools.executeTool("fetch_content", { url: "https://nodejs.org/api/synopsis.html" }, { signal });
  const fetchMs = Math.round(performance.now() - startedFetch);
  assert.equal(fetch.isError, false, `fetch_content failed: ${fetch.result.content.filter((part) => part.type === "text").map((part) => part.text).join(" ")}`);
  assert.ok(fetch.result.content.some((part) => part.type === "text" && part.text.includes("Node.js")), "Fetch did not return public page content");
  assert.equal(existsSync(join(agentDir, "web-search.json")), false);
  assert.equal(existsSync(browserMarker), false, "The default workflow attempted xdg-open");
  console.log(JSON.stringify({ profile: "temporary; no web-search.json or search keys", runtime: "PiSessionService default factory", provider: "exa (keyless MCP)", searchMs, results: details.totalResults, fetchMs, fetchedUrl: "https://nodejs.org/api/synopsis.html", fetched: "Node.js synopsis", browserAttempts: 0 }));
} finally {
  await service.dispose();
  await rm(root, { recursive: true, force: true });
}
