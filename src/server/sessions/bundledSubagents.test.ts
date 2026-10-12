import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { preferBundledExtensions } from "./bundledExtensions.js";
import { bundledSubagentsPackagePath } from "./bundledSubagents.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("bundled subagents resources", () => {
  it("loads the bundled extension, skill, and prompts without Pi package settings", async () => {
    const loader = await subagentsLoader();

    expectBundledSubagents(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
  });

  it("deduplicates the bundle when the Pi profile loads the same package", async () => {
    const loader = await subagentsLoader([bundledSubagentsPackagePath()]);

    expectBundledSubagents(loader);
    expect(loader.getExtensions().warnings ?? []).toEqual([]);
  });

  it("drops a different pi-subagents copy from the Pi profile and says where it came from", async () => {
    const root = await tempRoot();
    const strayRoot = join(root, "stray-pi-subagents");
    await mkdir(strayRoot, { recursive: true });
    await writeFile(join(strayRoot, "package.json"), JSON.stringify({
      name: "pi-subagents",
      version: "0.24.0",
      type: "module",
      pi: { extensions: ["./index.js"] },
    }), "utf8");
    await writeFile(join(strayRoot, "index.js"), [
      "export default function stray(pi) {",
      "  pi.registerTool({ name: 'subagent', label: 'stray', description: 'stray copy', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [], details: undefined }) });",
      "}",
      "",
    ].join("\n"), "utf8");

    const loader = await subagentsLoader([strayRoot], root);

    expectBundledSubagents(loader);
    expect(extensionPaths(loader).some((path) => path.startsWith(strayRoot))).toBe(false);
    const warnings = loader.getExtensions().warnings ?? [];
    expect(warnings.map((warning) => warning.path)).toEqual([strayRoot]);
    expect(warnings[0]?.warning).toContain(bundledSubagentsPackagePath());
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-subagents-"));
  tempRoots.push(root);
  return root;
}

async function subagentsLoader(packages: string[] = [], existingRoot?: string): Promise<DefaultResourceLoader> {
  const root = existingRoot ?? await tempRoot();
  const agentDir = join(root, "agent");
  if (packages.length > 0) {
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({ packages })}\n`, "utf8");
  }
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    additionalExtensionPaths: [bundledSubagentsPackagePath()],
    extensionsOverride: preferBundledExtensions,
    noContextFiles: true,
  });
  await loader.reload();
  return loader;
}

function extensionPaths(loader: DefaultResourceLoader): string[] {
  return loader.getExtensions().extensions.map((extension) => extension.path);
}

function expectBundledSubagents(loader: DefaultResourceLoader): void {
  const bundledRoot = bundledSubagentsPackagePath();
  const extensions = loader.getExtensions();
  expect(extensions.errors).toEqual([]);
  const owners = extensions.extensions.filter((extension) => extension.tools.has("subagent"));
  expect(owners.map((extension) => extension.path)).toEqual([join(bundledRoot, "index.js")]);
  expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("pi-subagents");
  expect(loader.getPrompts().prompts.length).toBeGreaterThan(0);
}
