import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledCliproxyProviderPackagePath, bundledCliproxyProviderResources } from "./bundledCliproxyProvider.js";
import { bootstrapAndFreezeGlobalExtensionProviders } from "./globalProviderPolicy.js";

const roots: string[] = [];
let root: string;
let agentDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-bundled-provider-"));
  roots.push(root);
  agentDir = join(root, "agent");
  await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("CLIPROXYAPI_API_KEY", "");
  vi.stubEnv("CLIPROXYAPI_BASE_URL", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

async function providerLoader(): Promise<DefaultResourceLoader> {
  const resources = bundledCliproxyProviderResources(root, agentDir);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager: resources.settingsManager,
    additionalExtensionPaths: [bundledCliproxyProviderPackagePath()],
    extensionsOverride: resources.extensionsOverride,
    noContextFiles: true,
  });
  await loader.reload();
  return loader;
}

function expectOnlyBundle(loader: DefaultResourceLoader): void {
  const result = loader.getExtensions();
  expect(result.errors).toEqual([]);
  expect(result.extensions.map((extension) => extension.path)).toEqual([
    join(bundledCliproxyProviderPackagePath(), "extensions", "index.ts"),
    join(bundledCliproxyProviderPackagePath(), "extensions", "tps.ts"),
  ]);
  const registration = result.runtime.pendingProviderRegistrations.find((item) => item.name === "cliproxyapi");
  expect(registration?.extensionPath).toBe(join(bundledCliproxyProviderPackagePath(), "extensions", "index.ts"));
  expect(result.extensions.filter((extension) => extension.commands.has("cliproxyapi-refresh"))).toHaveLength(1);
}

async function providerCopy(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify({
    name: "@router-for-me/pi-cliproxyapi-provider",
    version: "1.4.18",
    type: "module",
    pi: { extensions: ["./index.js"] },
  }));
  const marker = join(root, "stray-factory-ran");
  await writeFile(join(path, "index.js"), `
    import { writeFileSync } from "node:fs";
    export default function (pi) {
      writeFileSync(${JSON.stringify(marker)}, "loaded");
      pi.unregisterProvider("cliproxyapi");
      pi.registerProvider("cliproxyapi", { baseUrl: "https://wrong.example", apiKey: "wrong-key" });
    }
  `);
  return path;
}

describe("bundled CLIProxyAPI provider", () => {
  it("loads both shipped extensions with no Pi package setting", async () => {
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
    expect(existsSync(join(agentDir, "settings.json"))).toBe(false);
  });

  it("loads one copy when the profile already names the bundle", async () => {
    const settings = JSON.stringify({ packages: [bundledCliproxyProviderPackagePath()] });
    await writeFile(join(agentDir, "settings.json"), settings);
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
    expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe(settings);
  });

  it("excludes an npm profile copy before its factory can erase the bundle's registration", async () => {
    const path = await providerCopy(join(agentDir, "npm", "node_modules", "@router-for-me", "pi-cliproxyapi-provider"));
    const settings = JSON.stringify({ packages: ["npm:@router-for-me/pi-cliproxyapi-provider@1.4.18"] });
    await writeFile(join(agentDir, "settings.json"), settings);
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(existsSync(join(root, "stray-factory-ran"))).toBe(false);
    expect(loader.getExtensions().warnings?.map((warning) => warning.path)).toEqual([path]);
    expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe(settings);
  });

  it("does not install an obsolete npm copy when a profile still names it", async () => {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:@router-for-me/pi-cliproxyapi-provider@1.4.18"] }));
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(existsSync(join(agentDir, "npm", "node_modules", "@router-for-me", "pi-cliproxyapi-provider"))).toBe(false);
  });

  it("excludes an explicitly enabled extension copy before its factory runs", async () => {
    const path = await providerCopy(join(root, "explicit-provider"));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: [`+${join(path, "index.js")}`] }));
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(existsSync(join(root, "stray-factory-ran"))).toBe(false);
  });

  it("excludes local package copies in project settings without rewriting them", async () => {
    const path = await providerCopy(join(root, "project-provider"));
    await mkdir(join(root, ".pi"));
    const settings = JSON.stringify({ packages: [{ source: path, extensions: ["./index.js"] }] });
    await writeFile(join(root, ".pi", "settings.json"), settings);
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(existsSync(join(root, "stray-factory-ran"))).toBe(false);
    expect(loader.getExtensions().warnings?.map((warning) => warning.path)).toEqual([path]);
    expect(await readFile(join(root, ".pi", "settings.json"), "utf8")).toBe(settings);
  });

  it("excludes an auto-discovered provider folder before factory evaluation", async () => {
    const path = await providerCopy(join(agentDir, "extensions", "old-provider"));
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    expect(existsSync(join(root, "stray-factory-ran"))).toBe(false);
    expect(loader.getExtensions().warnings?.map((warning) => warning.path)).toEqual([path]);
  });

  it("re-reads profile settings on reload and clears warnings after a copy is removed", async () => {
    const path = await providerCopy(join(root, "old-provider"));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [path] }));
    const loader = await providerLoader();
    expectOnlyBundle(loader);
    await writeFile(join(agentDir, "settings.json"), "{}");
    await loader.reload();
    expectOnlyBundle(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
  });

  it("registers the bundled provider in the daemon baseline even on a clean profile", async () => {
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    await bootstrapAndFreezeGlobalExtensionProviders(runtime, agentDir, logger);
    expect(runtime.getRegisteredProviderIds()).toContain("cliproxyapi");
    expect(runtime.getProvider("cliproxyapi")?.auth.oauth).toBeDefined();
    expect(runtime.getRegisteredProviderConfig("cliproxyapi")?.baseUrl).toBe("http://127.0.0.1:8317/backend-api/");
  });

  it("loads a configured catalog from a loopback fixture before freezing the baseline", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      expect(request.headers.authorization).toBe("Bearer fixture-key");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5.4", object: "model" }] }));
    });
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
      const baseUrl = `http://127.0.0.1:${String(address.port)}`;
      await writeFile(join(agentDir, "cliproxyapi.json"), JSON.stringify({ baseUrl, apiKey: "fixture-key" }));
      const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
      await bootstrapAndFreezeGlobalExtensionProviders(runtime, agentDir, logger);
      expect(requests.map((path) => new URL(path, baseUrl).pathname)).toEqual(["/v1/models"]);
      expect(runtime.getModel("cliproxyapi", "gpt-5.4")).toBeDefined();
      expect(runtime.getRegisteredProviderConfig("cliproxyapi")?.baseUrl).toBe(`${baseUrl}/backend-api/`);
    } finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
    }
  });
});
