import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { bundledForgerieSkillsPackagePath, preferBundledForgerieSkills } from "./bundledForgerieSkills.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("bundled Forgerie skills", () => {
  it("loads Forgerie-only skills without using the shared Pi profile", async () => {
    const loader = await forgerieSkillsLoader();

    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills
      .filter((skill) => skill.filePath.startsWith(bundledForgerieSkillsPackagePath()))
      .map((skill) => skill.name)
      .sort()).toEqual(["ask-user", "handoff", "processes", "relay"]);
  });

  it("prefers the bundled handoff over a shared-profile skill with the same name", async () => {
    const root = await createTempRoot();
    const sharedHandoff = join(root, "agent", "skills", "handoff");
    await mkdir(sharedHandoff, { recursive: true });
    await writeFile(
      join(sharedHandoff, "SKILL.md"),
      "---\nname: handoff\ndescription: Shared handoff\n---\nDo not spawn a session.\n",
      "utf8",
    );

    const loader = await forgerieSkillsLoader(root);
    const handoff = loader.getSkills().skills.find((skill) => skill.name === "handoff");

    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(handoff?.filePath).toBe(join(bundledForgerieSkillsPackagePath(), "handoff", "SKILL.md"));
  });
});

async function forgerieSkillsLoader(existingRoot?: string): Promise<DefaultResourceLoader> {
  const root = existingRoot ?? await createTempRoot();
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [bundledForgerieSkillsPackagePath()],
    skillsOverride: preferBundledForgerieSkills,
    noContextFiles: true,
  });
  await loader.reload();
  return loader;
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-bundled-skills-"));
  tempRoots.push(root);
  return root;
}
