import { execFileSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { ResourceEditorFileSchema, ResourceEditorInventorySchema, ResourceEditorSaveSchema, RESOURCE_EDITOR_MAX_BYTES, type ResourceEditorInventory } from "../../shared/resourceEditor.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { ResourceEditorService } from "./resourceEditorService.js";
import { ResourceEditorError } from "./resourceEditorFiles.js";

let root: string;
let profile: string;
let project: string;
let bundle: string;
const skill = (name: string, body = "Read the file.", manual = false) => `---\nname: ${name}\ndescription: A skill for ${name}.\ndisable-model-invocation: ${String(manual)}\n---\n\n${body}\n`;
async function file(path: string, text: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["--literal-pathspecs", ...args], { cwd, encoding: "utf8", env: { ...sanitizedGitEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trimEnd();
}
async function initializeGit(): Promise<void> {
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "Resource tests"]);
  git(project, ["config", "user.email", "resources@example.invalid"]);
  await file(join(project, "AGENTS.md"), "Project context.\n");
  await file(join(project, ".agents/skills/project/SKILL.md"), skill("project"));
  git(project, ["add", "."]);
  git(project, ["commit", "-m", "Initial files"]);
}
function resourceAt(inventory: ResourceEditorInventory, path: string) {
  const entry = inventory.resources.find((resource) => resource.path === path);
  if (entry === undefined) throw new Error(`Expected resource at ${path}`);
  return entry;
}
function service(cwd = project, readOnlyReason?: string): ResourceEditorService {
  return new ResourceEditorService({ agentDir: profile, bundledPaths: [bundle], session: (id) => {
    if (id !== "session") throw new ResourceEditorError("not-found", "Session not found.");
    return Promise.resolve({ cwd, ...(readOnlyReason === undefined ? {} : { readOnlyReason }) });
  } });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-resource-editor-"));
  profile = join(root, "profile"); project = join(root, "project"); bundle = join(root, "bundle");
  vi.stubEnv("HOME", root);
  await mkdir(profile, { recursive: true }); await mkdir(project); await mkdir(bundle);
  await file(join(profile, "settings.json"), "{}");
  await file(join(bundle, "package.json"), JSON.stringify({ name: "test-bundle", pi: { skills: ["skills"], prompts: ["prompts"] } }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("resource editor inventory", () => {
  it("separates Settings from the session's project and preserves origin, shadowing and manual metadata", async () => {
    await file(join(profile, "skills/handoff/SKILL.md"), skill("handoff"));
    await file(join(root, ".agents/skills/manual/SKILL.md"), skill("manual", "Only on request.", true));
    await file(join(bundle, "skills/handoff/SKILL.md"), skill("handoff"));
    await file(join(profile, "settings.json"), JSON.stringify({ packages: [{ source: bundle, skills: [] }] }));
    await file(join(project, ".agents/skills/project/SKILL.md"), skill("project"));
    await file(join(project, ".pi/prompts/review.md"), "---\ndescription: Project review.\n---\nRead $1.\n");
    await file(join(profile, "prompts/review.md"), "Review this file.\n");
    await file(join(profile, "AGENTS.md"), "Profile context.\n");
    await file(join(project, "AGENTS.md"), "Project context.\n");
    const editor = service();
    const settings = await editor.inventory();
    const session = await editor.inventory("session");
    expect(Check(ResourceEditorInventorySchema, settings)).toBe(true);
    expect(Check(ResourceEditorInventorySchema, session)).toBe(true);
    expect(new Set(session.resources.map((entry) => entry.id)).size).toBe(session.resources.length);
    expect(settings.resources.some((entry) => entry.origin.scope === "project")).toBe(false);
    expect(session.scope).toEqual({ kind: "session", sessionId: "session", cwd: project });
    expect(session.resources.find((entry) => entry.name === "project")).toMatchObject({ origin: { kind: "project" }, edit: { kind: "writable", saveEffect: "uncommitted" } });
    const builtin = session.resources.find((entry) => entry.name === "handoff" && entry.origin.kind === "bundled");
    expect(builtin).toMatchObject({ activation: { kind: "active" }, edit: { kind: "read-only" } });
    expect(session.resources.find((entry) => entry.name === "handoff" && entry.origin.kind === "user")).toMatchObject({ activation: { kind: "shadowed", winnerId: builtin?.id } });
    expect(session.resources.find((entry) => entry.name === "manual")).toMatchObject({ manual: true });
    const projectPrompt = session.resources.find((entry) => entry.kind === "prompt" && entry.origin.kind === "project");
    expect(session.resources.find((entry) => entry.kind === "prompt" && entry.origin.kind === "user")).toMatchObject({ activation: { kind: "shadowed", winnerId: projectPrompt?.id } });
  });

  it("honors configured custom paths, disabled resources and package filters without executing extensions", async () => {
    const packageDir = join(root, "package");
    await file(join(packageDir, "package.json"), JSON.stringify({ name: "test-package", pi: { skills: ["skills"], extensions: ["extension.mjs"] } }));
    await file(join(packageDir, "extension.mjs"), `throw new Error("Extension code must not run");`);
    await file(join(packageDir, "skills/package/SKILL.md"), skill("package"));
    await file(join(profile, "skills/disabled/SKILL.md"), skill("disabled"));
    await file(join(root, "custom/SKILL.md"), skill("custom"));
    await file(join(profile, "settings.json"), JSON.stringify({ packages: [packageDir], skills: [join(root, "custom"), "-skills/disabled"] }));
    const inventory = await service().inventory();
    expect(inventory.resources.find((entry) => entry.name === "package")).toMatchObject({ origin: { kind: "package", source: packageDir }, edit: { kind: "read-only" } });
    expect(inventory.resources.find((entry) => entry.name === "custom")).toMatchObject({ edit: { kind: "writable" } });
    expect(inventory.resources.find((entry) => entry.name === "disabled")).toMatchObject({ activation: { kind: "disabled" } });
    await file(join(profile, "settings.json"), JSON.stringify({ packages: [{ source: packageDir, skills: [] }] }));
    expect((await service().inventory()).resources.find((entry) => entry.name === "package")).toMatchObject({ activation: { kind: "disabled" } });
  });

  it("shows invalid metadata, context alternatives and system-prompt precedence", async () => {
    await file(join(profile, "skills/broken/SKILL.md"), "---\nname: broken\n---\nNo description.\n");
    await file(join(profile, "AGENTS.md"), "Profile context.\n");
    await file(join(profile, "SYSTEM.md"), "Profile system.\n");
    await file(join(project, "AGENTS.md"), "Default project context.\n");
    await file(join(project, "AGENTS.override.md"), "Override project context.\n");
    await file(join(project, ".pi/SYSTEM.md"), "Project system.\n");
    await file(join(project, ".pi/APPEND_SYSTEM.md"), "Project append.\n");
    const inventory = await service().inventory("session");
    expect(inventory.resources.find((entry) => entry.name === "broken")).toMatchObject({ activation: { kind: "invalid" } });
    const override = inventory.resources.find((entry) => entry.path === join(project, "AGENTS.override.md"));
    expect(inventory.resources.find((entry) => entry.path === join(project, "AGENTS.md"))).toMatchObject({ activation: { kind: "shadowed", winnerId: override?.id } });
    const system = inventory.resources.find((entry) => entry.path === join(project, ".pi/SYSTEM.md"));
    expect(inventory.resources.find((entry) => entry.path === join(profile, "SYSTEM.md"))).toMatchObject({ activation: { kind: "shadowed", winnerId: system?.id } });
    expect(inventory.resources.find((entry) => entry.name === "APPEND_SYSTEM.md")).toMatchObject({ activation: { kind: "active" } });
  });

  it("reports a missing package without installing it", async () => {
    await file(join(profile, "settings.json"), JSON.stringify({ packages: ["npm:forgerie-resource-test-not-installed@0.0.0"] }));
    const inventory = await service().inventory();
    expect(inventory.diagnostics).toContain("Package is not installed: npm:forgerie-resource-test-not-installed@0.0.0");
    expect(inventory.resources).toHaveLength(0);
  });

  it("uses the linked worktree's context instead of the main ancestor copy", async () => {
    await initializeGit();
    const worktree = join(project, ".worktree", "feature");
    git(project, ["worktree", "add", worktree, "-b", "feature"]);
    const inventory = await service(worktree).inventory("session");
    const contexts = inventory.resources.filter((entry) => entry.kind === "context");
    expect(contexts.some((entry) => entry.path === join(project, "AGENTS.md"))).toBe(false);
    expect(contexts.find((entry) => entry.path === join(worktree, "AGENTS.md"))).toMatchObject({ edit: { kind: "writable", saveEffect: "uncommitted" } });
  });
});

describe("resource file editing", () => {
  it("preserves exact text, line endings, BOM and permissions without rewriting frontmatter", async () => {
    const path = join(profile, "prompts/raw.md");
    await file(path, "\uFEFF---\r\ndescription: Raw\r\n---\r\n\r\nBefore\r\n");
    await chmod(path, 0o640);
    const editor = service();
    const entry = resourceAt(await editor.inventory(), path);
    const before = await editor.read(entry.id);
    expect(Check(ResourceEditorFileSchema, before)).toBe(true);
    expect(before.text).toBe(await readFile(path, "utf8"));
    const text = before.text.replace("Before", "After");
    const saved = await editor.save(entry.id, { text, baseRevision: before.revision });
    expect(Check(ResourceEditorSaveSchema, saved)).toBe(true);
    expect(saved.effect).toEqual({ kind: "file-only" });
    expect(saved.file.text).toBe(text);
    expect(await readFile(path, "utf8")).toBe(text);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(saved.file.revision).not.toBe(before.revision);
    expect((await editor.save(entry.id, { text, baseRevision: saved.file.revision })).effect).toEqual({ kind: "unchanged" });
  });

  it("refuses a stale revision and lets only one concurrent save win", async () => {
    const path = join(profile, "prompts/edit.md"); await file(path, "Before\n");
    const editor = service(); const id = resourceAt(await editor.inventory(), path).id;
    const before = await editor.read(id);
    const results = await Promise.allSettled([editor.save(id, { text: "First\n", baseRevision: before.revision }), editor.save(id, { text: "Second\n", baseRevision: before.revision })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { kind: "conflict" } });
    const current = await editor.read(id);
    await file(path, "Changed externally\n");
    await expect(editor.save(id, { text: "Overwrite\n", baseRevision: current.revision })).rejects.toMatchObject({ kind: "conflict" });
    expect(await readFile(path, "utf8")).toBe("Changed externally\n");
  });

  it("never writes package resources, archived-session resources, symlink escapes or hard links", async () => {
    await file(join(bundle, "skills/locked/SKILL.md"), skill("locked"));
    const outside = join(root, "outside/SKILL.md"); await file(outside, skill("outside"));
    await mkdir(join(profile, "skills"), { recursive: true });
    await symlink(dirname(outside), join(profile, "skills/escape"));
    await file(join(profile, "prompts/link-source.md"), "Linked\n");
    await link(join(profile, "prompts/link-source.md"), join(profile, "prompts/hardlink.md"));
    const editor = service(); const inventory = await editor.inventory();
    for (const entry of inventory.resources) {
      expect(entry.edit.kind).toBe("read-only");
      const before = await editor.read(entry.id);
      await expect(editor.save(entry.id, { text: "Overwrite\n", baseRevision: before.revision })).rejects.toMatchObject({ kind: "read-only" });
    }
    expect(await readFile(outside, "utf8")).toBe(skill("outside"));
    await file(join(project, "AGENTS.md"), "Project\n");
    const archived = service(project, "Archived session.");
    expect((await archived.inventory("session")).resources.every((entry) => entry.edit.kind === "read-only")).toBe(true);
  });

  it("rechecks links after a read, bounds content bytes and refuses arbitrary identities", async () => {
    const path = join(profile, "prompts/bounded.md"); await file(path, "Before\n");
    const outside = join(root, "outside.md"); await file(outside, "Outside\n");
    const editor = service(); const id = resourceAt(await editor.inventory(), path).id;
    const before = await editor.read(id);
    await rm(path); await symlink(outside, path);
    await expect(editor.save(id, { text: "Overwrite\n", baseRevision: before.revision })).rejects.toMatchObject({ kind: "read-only" });
    expect(await readFile(outside, "utf8")).toBe("Outside\n");
    await rm(path); await file(path, "Before\n");
    const current = await editor.read(id);
    await expect(editor.save(id, { text: "é".repeat(RESOURCE_EDITOR_MAX_BYTES), baseRevision: current.revision })).rejects.toMatchObject({ kind: "over-limit" });
    await file(path, "a".repeat(RESOURCE_EDITOR_MAX_BYTES + 1));
    await expect(editor.read(id)).rejects.toMatchObject({ kind: "over-limit" });
    await expect(editor.read("a".repeat(64))).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("Pi text-resource reload", () => {
  it("picks up saved skills, prompts and context only after an explicit SDK reload", async () => {
    const skillPath = join(profile, "skills/reload/SKILL.md");
    const promptPath = join(project, ".pi/prompts/reload.md");
    const contextPath = join(project, "AGENTS.md");
    await file(skillPath, skill("before")); await file(promptPath, "Before prompt.\n"); await file(contextPath, "Before context.\n");
    const loader = new DefaultResourceLoader({ cwd: project, agentDir: profile, noExtensions: true, noThemes: true });
    await loader.reload();
    const editor = service();
    for (const [path, text] of [[skillPath, skill("after")], [promptPath, "After prompt.\n"], [contextPath, "After context.\n"]] as const) {
      const id = resourceAt(await editor.inventory("session"), path).id;
      const current = await editor.read(id, "session");
      expect((await editor.save(id, { text, baseRevision: current.revision }, "session")).reload).toBe("explicit-session-reload");
    }
    expect(loader.getSkills().skills[0]?.name).toBe("before");
    expect(loader.getPrompts().prompts[0]?.content).toBe("Before prompt.\n");
    expect(loader.getAgentsFiles().agentsFiles.find((file) => file.path === contextPath)?.content).toBe("Before context.\n");
    await loader.reload();
    expect(loader.getSkills().skills[0]?.name).toBe("after");
    expect(loader.getPrompts().prompts[0]?.content).toBe("After prompt.\n");
    expect(loader.getAgentsFiles().agentsFiles.find((file) => file.path === contextPath)?.content).toBe("After context.\n");
  });
});

describe("main checkout commits", () => {
  it("commits only the resource and preserves other staged and unstaged changes", async () => {
    await initializeGit();
    await file(join(project, "unrelated.md"), "Do not commit this.\n");
    git(project, ["add", "unrelated.md"]);
    await file(join(project, "another.md"), "Untracked.\n");
    const editor = service(); const path = join(project, "AGENTS.md");
    const id = resourceAt(await editor.inventory("session"), path).id;
    const before = await editor.read(id, "session");
    expect(before.resource.edit).toEqual({ kind: "writable", saveEffect: "commit" });
    const saved = await editor.save(id, { text: "New context.\n", baseRevision: before.revision }, "session");
    expect(Check(ResourceEditorSaveSchema, saved)).toBe(true);
    expect(saved.effect).toMatchObject({ kind: "committed", sha: git(project, ["rev-parse", "HEAD"]), branch: "main" });
    expect(git(project, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).toBe("AGENTS.md");
    expect(git(project, ["diff", "--cached", "--name-only"])).toBe("unrelated.md");
    expect(git(project, ["status", "--porcelain", "--", "AGENTS.md"])).toBe("");
    expect(await readFile(join(project, "another.md"), "utf8")).toBe("Untracked.\n");
  });

  it("leaves a linked worktree save uncommitted", async () => {
    await initializeGit(); const worktree = join(root, "feature");
    git(project, ["worktree", "add", worktree, "-b", "feature"]);
    const editor = service(worktree); const path = join(worktree, "AGENTS.md");
    const id = resourceAt(await editor.inventory("session"), path).id;
    const before = await editor.read(id, "session"); const head = git(worktree, ["rev-parse", "HEAD"]);
    const saved = await editor.save(id, { text: "Worktree context.\n", baseRevision: before.revision }, "session");
    expect(saved.effect).toEqual({ kind: "uncommitted" });
    expect(git(worktree, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(worktree, ["diff", "--name-only"])).toBe("AGENTS.md");
    expect(await readFile(join(project, "AGENTS.md"), "utf8")).toBe("Project context.\n");
  });

  it("refuses dirty target files, detached HEAD and unfinished Git operations before writing", async () => {
    await initializeGit(); const editor = service(); const path = join(project, "AGENTS.md");
    const id = resourceAt(await editor.inventory("session"), path).id;
    await file(path, "Already dirty.\n"); let current = await editor.read(id, "session");
    await expect(editor.save(id, { text: "New\n", baseRevision: current.revision }, "session")).rejects.toMatchObject({ kind: "unsafe-git-state", savedToDisk: false });
    expect(await readFile(path, "utf8")).toBe("Already dirty.\n");
    git(project, ["restore", "AGENTS.md"]); git(project, ["checkout", "--detach"]); current = await editor.read(id, "session");
    await expect(editor.save(id, { text: "New\n", baseRevision: current.revision }, "session")).rejects.toMatchObject({ kind: "unsafe-git-state" });
    git(project, ["checkout", "main"]); await file(join(project, ".git/MERGE_HEAD"), `${git(project, ["rev-parse", "HEAD"])}\n`); current = await editor.read(id, "session");
    await expect(editor.save(id, { text: "New\n", baseRevision: current.revision }, "session")).rejects.toMatchObject({ kind: "unsafe-git-state" });
    expect(await readFile(path, "utf8")).toBe("Project context.\n");
  });

  it("refuses index flags that hide a target's existing changes", async () => {
    await initializeGit(); const path = join(project, "AGENTS.md");
    git(project, ["update-index", "--assume-unchanged", "AGENTS.md"]);
    await file(path, "Hidden existing change.\n");
    const editor = service(); const id = resourceAt(await editor.inventory("session"), path).id;
    const before = await editor.read(id, "session");
    await expect(editor.save(id, { text: "Overwrite\n", baseRevision: before.revision }, "session")).rejects.toMatchObject({ kind: "unsafe-git-state", savedToDisk: false });
    expect(await readFile(path, "utf8")).toBe("Hidden existing change.\n");
  });

  it("does not report success when a hook adds another file to the commit", async () => {
    await initializeGit(); const path = join(project, "AGENTS.md");
    await file(join(project, "other.md"), "Hook-added file.\n");
    const hook = join(project, ".git/hooks/pre-commit"); await file(hook, "#!/bin/sh\ngit add other.md\n"); await chmod(hook, 0o755);
    const editor = service(); const id = resourceAt(await editor.inventory("session"), path).id;
    const before = await editor.read(id, "session");
    await expect(editor.save(id, { text: "Updated context.\n", baseRevision: before.revision }, "session")).rejects.toMatchObject({ kind: "commit-failed", savedToDisk: true });
    expect(git(project, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).toBe("AGENTS.md\nother.md");
  });

  it("runs repository hooks and reports a saved file when a commit fails", async () => {
    await initializeGit(); const path = join(project, "AGENTS.md"); const head = git(project, ["rev-parse", "HEAD"]);
    const hook = join(project, ".git/hooks/pre-commit"); await file(hook, "#!/bin/sh\nexit 1\n"); await chmod(hook, 0o755);
    const editor = service(); const id = resourceAt(await editor.inventory("session"), path).id;
    const before = await editor.read(id, "session");
    await expect(editor.save(id, { text: "Saved, not committed.\n", baseRevision: before.revision }, "session")).rejects.toMatchObject({ kind: "commit-failed", savedToDisk: true });
    expect(await readFile(path, "utf8")).toBe("Saved, not committed.\n");
    expect(git(project, ["rev-parse", "HEAD"])).toBe(head);
  });
});
