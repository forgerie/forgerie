import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preferBundledExtensions } from "./bundledExtensions.js";
import { bundledSubagentsPackagePath } from "./bundledSubagents.js";
import { bundledWebAccessPackagePath } from "./bundledWebAccess.js";

const tempRoots: string[] = [];
const webTools = ["web_search", "fetch_content", "get_search_content", "source_check"];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("bundled web access resources", () => {
  it("resolves the exact bundled package and loads all four tools without profile settings", async () => {
    const manifest: unknown = JSON.parse(await readFile(join(bundledWebAccessPackagePath(), "package.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "pi-web-access", version: "0.39.0" });
    const { loader } = await webLoader();
    expectWebTools(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
    expect(loader.getExtensions().extensions.some((extension) => extension.tools.has("subagent"))).toBe(true);
  });

  it("deduplicates a profile using the bundled path", async () => {
    const { loader } = await webLoader([bundledWebAccessPackagePath()]);
    expectWebTools(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
  });

  it("drops a profile copy with a warning naming the bundle", async () => {
    const root = await tempRoot();
    const stray = await extensionPackage(root, "pi-web-access", webTools);
    const { loader } = await webLoader([stray], root);
    expectWebTools(loader);
    expect(loader.getExtensions().extensions.some((extension) => extension.path.startsWith(stray))).toBe(false);
    const warnings = loader.getExtensions().warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.path).toBe(stray);
    expect(warnings[0]?.warning).toContain(bundledWebAccessPackagePath());
  });

  it("warns for competing web tools, preserves other errors and tools, and keeps Pi's first winner", async () => {
    const root = await tempRoot();
    const competitor = await extensionPackage(root, "other-web-tools", [...webTools, "web_fetch", "subagent"]);
    const { loader, agentDir } = await webLoader([competitor], root);
    const loaded = loader.getExtensions();
    expect(loaded.extensions.some((extension) => extension.path.startsWith(competitor))).toBe(true);
    expect(loaded.errors).toEqual([{
      path: join(competitor, "index.js"),
      error: `Tool "subagent" conflicts with ${join(bundledSubagentsPackagePath(), "index.js")}`,
    }]);
    expect(loaded.warnings).toHaveLength(4);
    for (const name of webTools) {
      const warning = loaded.warnings?.find((item) => item.warning.includes(`tool "${name}"`));
      expect(warning?.path).toBe(join(competitor, "index.js"));
      expect(warning?.warning).toContain(`Forgerie bundles pi-web-access; tool "${name}"`);
    }
    const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), new ModelRegistry(models));
    const tools = runner.getAllRegisteredTools();
    for (const name of webTools) {
      expect(tools.find((tool) => tool.definition.name === name)?.sourceInfo.path).toBe(join(bundledWebAccessPackagePath(), "dist", "index.js"));
    }
    expect(tools.find((tool) => tool.definition.name === "web_fetch")?.sourceInfo.path).toBe(join(competitor, "index.js"));
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-web-access-"));
  tempRoots.push(root);
  return root;
}

async function extensionPackage(root: string, name: string, tools: string[]): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify({ name, version: "0.1.0", type: "module", pi: { extensions: ["./index.js"] } }));
  await writeFile(join(path, "index.js"), `export default function extension(pi) {\n${tools.map((name) => `pi.registerTool({ name: '${name}', label: 'profile', description: 'profile tool', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [], details: undefined }) });`).join("\n")}\n}\n`);
  return path;
}

async function webLoader(packages: string[] = [], existingRoot?: string): Promise<{ loader: DefaultResourceLoader; agentDir: string }> {
  const root = existingRoot ?? await tempRoot();
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages }));
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir,
    additionalExtensionPaths: [bundledSubagentsPackagePath(), bundledWebAccessPackagePath()],
    extensionsOverride: preferBundledExtensions,
    noContextFiles: true,
  });
  await loader.reload();
  return { loader, agentDir };
}

function expectWebTools(loader: DefaultResourceLoader): void {
  const loaded = loader.getExtensions();
  expect(loaded.errors).toEqual([]);
  for (const name of webTools) {
    expect(loaded.extensions.filter((extension) => extension.tools.has(name)).map((extension) => extension.path))
      .toEqual([join(bundledWebAccessPackagePath(), "dist", "index.js")]);
  }
}
