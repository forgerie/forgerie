import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { preferBundledExtensions } from "./bundledExtensions.js";
import { bundledForgerieSkillsPackagePath, preferBundledForgerieSkills } from "./bundledForgerieSkills.js";
import { bundledManagedProcessesPackagePath } from "./bundledManagedProcesses.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("bundled managed processes resources", () => {
  it("loads the bundled extensions and skill without Pi package settings", async () => {
    const loader = await managedProcessesLoader();

    expectManagedProcessResources(loader);
  });

  it("deduplicates the bundle when the TUI profile configures the same package", async () => {
    const packagePath = bundledManagedProcessesPackagePath();
    const loader = await managedProcessesLoader([packagePath]);

    expectManagedProcessResources(loader);
  });
});

async function managedProcessesLoader(packages: string[] = []): Promise<DefaultResourceLoader> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-managed-processes-"));
  tempRoots.push(root);
  const agentDir = join(root, "agent");
  if (packages.length > 0) {
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({ packages })}\n`, "utf8");
  }
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    additionalExtensionPaths: [bundledManagedProcessesPackagePath()],
    noContextFiles: true,
  });
  await loader.reload();
  return loader;
}

function expectManagedProcessResources(loader: DefaultResourceLoader): void {
  expect(loader.getExtensions().errors).toEqual([]);
  expect(loader.getExtensions().extensions.map((extension) => extension.path).sort()).toEqual([
    expect.stringMatching(/extensions\/processes-dock\/index\.ts$/u),
    expect.stringMatching(/extensions\/processes-logs\/index\.ts$/u),
    expect.stringMatching(/extensions\/processes\/index\.ts$/u),
  ]);
  expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("pi-processes");
}


it("drops the conflicting package tool and skill from hosted resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-owned-processes-")); tempRoots.push(root);
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), noContextFiles: true,
    additionalExtensionPaths: [bundledManagedProcessesPackagePath(), bundledForgerieSkillsPackagePath()],
    extensionsOverride: preferBundledExtensions, skillsOverride: preferBundledForgerieSkills });
  await loader.reload();
  expect(loader.getExtensions().extensions.flatMap(extension => [...extension.tools.keys()])).not.toContain("process");
  expect(loader.getExtensions().warnings?.some(warning => warning.warning.includes("Forgerie replaced"))).toBe(true);
  expect(loader.getSkills().skills.map(skill => skill.name)).toContain("processes");
  expect(loader.getSkills().skills.map(skill => skill.name)).not.toContain("pi-processes");
});
