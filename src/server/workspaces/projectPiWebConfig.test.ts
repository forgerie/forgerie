import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEffectiveProjectPathAccess, loadEffectiveProjectUploadsConfig, loadProjectPiWebConfig, mergePathAccessConfigs, PROJECT_PI_WEB_CONFIG_PATH } from "./projectPiWebConfig.js";

let tempDir: string;
let projectPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-project-config-test-"));
  projectPath = join(tempDir, "project");
  await mkdir(projectPath, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("project Forgerie config", () => {
  it("returns an empty config when the project-local config is absent", async () => {
    await expect(loadProjectPiWebConfig(projectPath)).resolves.toEqual({
      path: join(projectPath, PROJECT_PI_WEB_CONFIG_PATH),
      exists: false,
      config: {},
    });
  });

  it("loads project-local path access and upload config", async () => {
    await writeProjectConfig({ version: 1, pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] }, uploads: { defaultFolder: "manual\\incoming" } });

    await expect(loadProjectPiWebConfig(projectPath)).resolves.toEqual({
      path: join(projectPath, PROJECT_PI_WEB_CONFIG_PATH),
      exists: true,
      config: { version: 1, pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] }, uploads: { defaultFolder: "manual/incoming" } },
    });
  });

  it("loads the project backlog override without changing other settings", async () => {
    await writeProjectConfig({ version: 1, backlog: { dir: "work/items/" }, uploads: { defaultFolder: "uploads" } });
    expect((await loadProjectPiWebConfig(projectPath)).config).toEqual({ version: 1, backlog: { dir: "work/items/" }, uploads: { defaultFolder: "uploads" } });
  });

  it.each(["", " ", "/outside", "../outside", "work/../../outside", "work\\\\items", "work\u0000items"])("rejects unsafe backlog directory %s", async (dir) => {
    await writeProjectConfig({ backlog: { dir } });
    const loaded = await loadProjectPiWebConfig(projectPath);
    expect(loaded.config.backlog).toBeUndefined();
    expect(loaded.backlogError).toContain("backlog.dir");
  });

  it("keeps uploads and path access when only the backlog section is wrong, so the workspace still opens", async () => {
    await writeProjectConfig({ backlog: { providers: ["markdown", "github"], dir: "../work/items" }, uploads: { defaultFolder: "uploads" } });
    const loaded = await loadProjectPiWebConfig(projectPath);
    expect(loaded.config).toEqual({ uploads: { defaultFolder: "uploads" } });
    expect(loaded.backlogError).toContain("from the project root (work/items), not from .forgerie/");
    await expect(loadEffectiveProjectUploadsConfig(projectPath, {})).resolves.toMatchObject({ defaultFolder: "uploads" });
    await writeProjectConfig({ backlog: { providers: ["jira"] } });
    expect((await loadProjectPiWebConfig(projectPath)).backlogError).toContain("backlog must be an object");
  });

  it("rejects unsupported project config versions", async () => {
    await writeProjectConfig({ version: 3 });

    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Forgerie project config version must be 1 or 2");
  });

  it("loads version 2 service declarations without losing uploads, path access or backlog behavior", async () => {
    const services = { file: "process-compose.yaml", ports: ["web", "db"], preview: "web" };
    await writeProjectConfig({ version: 2, env: ["nix", "develop", "-c"], services, pathAccess: { allowedPaths: ["/tmp"] }, uploads: { defaultFolder: "uploads" }, backlog: { dir: "../bad" } });
    const loaded = await loadProjectPiWebConfig(projectPath);
    expect(loaded.config).toEqual({ version: 2, env: ["nix", "develop", "-c"], services, pathAccess: { allowedPaths: ["/tmp"] }, uploads: { defaultFolder: "uploads" } });
    expect(loaded.backlogError).toContain("backlog.dir");
  });

  it.each(["../outside", "/outside", "nested/../../outside", "a\\\\b"])('rejects service paths outside the worktree: %s', async (file) => {
    await writeProjectConfig({ version: 2, services: file });
    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Invalid project services");
  });

  it("rejects shell strings and conflicting port variable names", async () => {
    await writeProjectConfig({ version: 2, env: "nix develop && echo bad" });
    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Invalid project env");
    await writeProjectConfig({ version: 2, services: { file: "pc.yaml", ports: ["web", "WEB"] } });
    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Invalid project services");
  });

  it("reuses Forgerie path access schema validation", async () => {
    await writeProjectConfig({ version: 1, pathAccess: { allowedPaths: [""] } });

    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Forgerie config pathAccess.allowedPaths must be an array of non-empty strings");
  });

  it("reuses Forgerie upload schema validation", async () => {
    await writeProjectConfig({ version: 1, uploads: { defaultFolder: "../outside" } });

    await expect(loadProjectPiWebConfig(projectPath)).rejects.toThrow("Forgerie config uploads.defaultFolder must not contain path traversal");
  });

  it("merges global and project path access in order", async () => {
    await writeProjectConfig({ version: 1, pathAccess: { allowedPaths: ["/project-sdk", "/shared"] } });

    await expect(loadEffectiveProjectPathAccess(projectPath, { pathAccess: { allowedPaths: ["/global-sdk", "/shared"] } })).resolves.toEqual({
      allowedPaths: ["/global-sdk", "/shared", "/project-sdk"],
    });
  });

  it("lets project upload defaults override global upload defaults", async () => {
    await writeProjectConfig({ version: 1, uploads: { defaultFolder: "project-uploads" } });

    await expect(loadEffectiveProjectUploadsConfig(projectPath, { uploads: { defaultFolder: "global-uploads" } })).resolves.toEqual({
      defaultFolder: "project-uploads",
    });
  });
});

describe("mergePathAccessConfigs", () => {
  it("returns undefined when no roots are configured", () => {
    expect(mergePathAccessConfigs(undefined, {})).toBeUndefined();
  });

  it("deduplicates configured roots", () => {
    expect(mergePathAccessConfigs({ allowedPaths: ["/a", "/b"] }, { allowedPaths: ["/b", "/c"] })).toEqual({ allowedPaths: ["/a", "/b", "/c"] });
  });
});

async function writeProjectConfig(value: unknown): Promise<void> {
  const path = join(projectPath, PROJECT_PI_WEB_CONFIG_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
