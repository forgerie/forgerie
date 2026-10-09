import { stat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DefaultPackageManager, SettingsManager, loadSkills, loadProjectContextFiles, parseFrontmatter, type ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { ResourceEditorEntry, ResourceEditorScope } from "../../shared/resourceEditor.js";
import { RESOURCE_EDITOR_MAX_ITEMS, RESOURCE_EDITOR_MAX_BYTES } from "../../shared/resourceEditor.js";
import { bundledForgerieSkillsPackagePath } from "../sessions/bundledForgerieSkills.js";
import { bundledManagedProcessesPackagePath } from "../sessions/bundledManagedProcesses.js";
import { bundledSubagentsPackagePath } from "../sessions/bundledSubagents.js";
import { insideResourceRoot, isMissingResource, readResourceFile, resourceHash, ResourceEditorError } from "./resourceEditorFiles.js";

export interface DiscoveredEditorResource {
  entry: Omit<ResourceEditorEntry, "edit">;
  writeRoot: string;
}
export interface EditorDiscovery { resources: DiscoveredEditorResource[]; diagnostics: string[] }
export interface EditorDiscoveryOptions { agentDir: string; bundledPaths?: readonly string[] }
const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

/** Resolves configured files only. Never loads extension code or installs missing packages. */
export class ResourceEditorDiscovery {
  private readonly agentDir: string;
  private readonly bundledPaths: readonly string[];
  constructor(options: EditorDiscoveryOptions) {
    this.agentDir = resolve(options.agentDir);
    this.bundledPaths = options.bundledPaths ?? [bundledManagedProcessesPackagePath(), bundledSubagentsPackagePath(), bundledForgerieSkillsPackagePath()];
  }

  async discover(scope: ResourceEditorScope): Promise<EditorDiscovery> {
    const cwd = scope.kind === "settings" ? this.agentDir : scope.cwd;
    const fileSettings = SettingsManager.create(cwd, this.agentDir, { projectTrusted: scope.kind === "session" });
    const settingsErrors = fileSettings.drainErrors();
    if (settingsErrors.length > 0) throw new ResourceEditorError("io-error", `Could not read Pi settings: ${settingsErrors.map((error) => error.error.message).join("; ")}`);
    const settingsManager = scope.kind === "settings" ? SettingsManager.inMemory(fileSettings.getGlobalSettings(), { projectTrusted: false }) : fileSettings;
    const manager = new DefaultPackageManager({ cwd, agentDir: this.agentDir, settingsManager });
    const diagnostics: string[] = ["This inventory describes configured files on disk, not the running session. Resources contributed dynamically by extension code are not scanned."];
    const paths = await manager.resolve((source) => { diagnostics.push(`Package is not installed: ${source}`); return Promise.resolve("skip"); });
    // These are local paths, so resolving them cannot trigger installation or git refresh.
    const bundled = await manager.resolveExtensionSources([...this.bundledPaths], { temporary: true });
    const resources: DiscoveredEditorResource[] = [];
    const seenFiles = new Set<string>();
    const seenConfiguredPaths = new Set<string>();
    const winners = new Map<string, string>();
    for (const kind of ["skill", "prompt"] as const) {
      const pathsForKind = kind === "skill" ? [...bundled.skills, ...paths.skills] : [...bundled.prompts, ...paths.prompts];
      for (const source of pathsForKind) {
        if (scope.kind === "settings" && source.metadata.scope === "project") continue;
        for (const path of await resourceFiles(source.path, kind)) {
          const identity = `${kind}:${String(source.enabled)}:${await realpath(path)}`;
          const configuredPath = `${kind}:${resolve(path)}`;
          if (seenFiles.has(identity) || seenConfiguredPaths.has(configuredPath)) continue;
          seenFiles.add(identity);
          seenConfiguredPaths.add(configuredPath);
          const root = await writeRoot(source);
          const entry = await this.describe(path, kind, source, root, cwd, source.enabled);
          const key = `${kind}:${entry.name}`;
          if (entry.activation.kind === "active") {
            const winner = winners.get(key);
            if (winner !== undefined) entry.activation = { kind: "shadowed", winnerId: winner };
            else winners.set(key, entry.id);
          }
          entry.description = entry.description.slice(0, 2048);
          resources.push({ entry, writeRoot: root });
          assertItemLimit(resources.length);
        }
      }
    }
    await this.contextResources(scope, resources);
    return { resources, diagnostics };
  }

  private async describe(path: string, kind: "skill" | "prompt", source: ResolvedResource, root: string, cwd: string, enabled: boolean): Promise<DiscoveredEditorResource["entry"]> {
    const originKind = this.bundledPaths.some((bundle) => insideResourceRoot(path, bundle)) ? "bundled" : source.metadata.origin === "package" ? "package" : source.metadata.scope === "project" ? "project" : "user";
    const entry: DiscoveredEditorResource["entry"] = {
      id: resourceHash(`${kind}:${resolve(path)}`), kind, name: kind === "skill" && basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, ".md"), description: "", path: resolve(path),
      origin: { kind: originKind, source: source.metadata.source, scope: source.metadata.scope, root },
      activation: enabled ? { kind: "active" } : { kind: "disabled" }, manual: false,
    };
    try {
      const { text } = await readResourceFile(path);
      if (kind === "skill") {
        const fields = parseFrontmatter(text).frontmatter;
        if (typeof fields["name"] === "string" && fields["name"] !== "") entry.name = fields["name"];
        const result = loadSkills({ cwd, agentDir: this.agentDir, skillPaths: [path], includeDefaults: false });
        const skill = result.skills[0];
        if (skill === undefined) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "Invalid skill file.");
        entry.name = skill.name;
        entry.description = skill.description;
        entry.manual = skill.disableModelInvocation;
      } else {
        const parsed = parseFrontmatter(text);
        entry.description = typeof parsed.frontmatter["description"] === "string" ? parsed.frontmatter["description"] : (parsed.body.split("\n").find((line) => line.trim() !== "") ?? "").slice(0, 60);
      }
    } catch (error) { entry.activation = { kind: "invalid", message: error instanceof Error ? error.message : String(error) }; }
    return entry;
  }

  private async contextResources(scope: ResourceEditorScope, resources: DiscoveredEditorResource[]): Promise<void> {
    const directories = [this.agentDir];
    if (scope.kind === "session") {
      let current = resolve(scope.cwd);
      for (;;) {
        if (!directories.includes(current)) directories.push(current);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    const candidates: string[] = [];
    for (const directory of directories) {
      for (const name of CONTEXT_NAMES) {
        const path = join(directory, name);
        if (await regularFile(path)) candidates.push(path);
      }
    }
    // The SDK reads context synchronously. Bound every candidate before asking it
    // which files it selects, including its nested-worktree shadowing rule.
    for (const path of candidates) if ((await stat(path)).size > RESOURCE_EDITOR_MAX_BYTES) throw new ResourceEditorError("over-limit", "A context file exceeds the 1 MiB editor limit.");
    const selected = scope.kind === "settings" ? candidates.filter((path) => dirname(path) === this.agentDir).slice(0, 1)
      : loadProjectContextFiles({ cwd: scope.cwd, agentDir: this.agentDir }).map((file) => file.path);
    const selectedByDirectory = new Map(selected.map((path) => [dirname(path), path]));
    for (const path of candidates) {
      const winner = selectedByDirectory.get(dirname(path));
      // A main-checkout ancestor can be excluded by the SDK for a nested worktree.
      // It is not part of this session's context inventory.
      if (winner === undefined) continue;
      resources.push(contextResource(path, dirname(path), this.agentDir, path === winner ? undefined : winner));
    }
    for (const name of ["SYSTEM.md", "APPEND_SYSTEM.md"]) {
      const project = scope.kind === "session" ? join(scope.cwd, ".pi", name) : undefined;
      const user = join(this.agentDir, name);
      const winner = project !== undefined && await regularFile(project) ? project : await regularFile(user) ? user : undefined;
      if (winner === undefined) continue;
      for (const path of [project, user]) {
        if (path !== undefined && await regularFile(path)) resources.push(contextResource(path, dirname(path), this.agentDir, path === winner ? undefined : winner));
      }
    }
    assertItemLimit(resources.length);
  }
}

function contextResource(path: string, root: string, agentDir: string, winner?: string): DiscoveredEditorResource {
  const user = insideResourceRoot(path, agentDir);
  return { writeRoot: root, entry: { id: resourceHash(`context:${path}`), kind: "context", name: basename(path), description: "", path,
    origin: { kind: user ? "user" : "project", source: "context", scope: user ? "user" : "project", root },
    activation: winner === undefined ? { kind: "active" } : { kind: "shadowed", winnerId: resourceHash(`context:${winner}`) }, manual: false } };
}

async function writeRoot(source: ResolvedResource): Promise<string> {
  if (source.metadata.baseDir !== undefined) return resolve(source.metadata.baseDir);
  return (await stat(source.path)).isDirectory() ? source.path : dirname(source.path);
}

async function resourceFiles(path: string, kind: "skill" | "prompt"): Promise<string[]> {
  if (!(await stat(path)).isDirectory()) return path.endsWith(".md") ? [path] : [];
  const files: string[] = [];
  const visited = new Set<string>();
  let scanned = 0;
  async function walk(directory: string, root: boolean): Promise<void> {
    const canonical = await realpath(directory);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    assertItemLimit(++scanned);
    if (kind === "skill" && await regularFile(join(directory, "SKILL.md"))) { files.push(join(directory, "SKILL.md")); return; }
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      assertItemLimit(++scanned);
      const child = join(directory, item.name);
      let info;
      try { info = await stat(child); }
      catch (error) { if (isMissingResource(error)) continue; throw error; }
      if (info.isFile() && root && item.name.endsWith(".md")) files.push(child);
      else if (info.isDirectory() && kind === "skill") await walk(child, false);
      assertItemLimit(files.length);
    }
  }
  await walk(path, true);
  return files;
}

async function regularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch (error) { if (isMissingResource(error)) return false; throw error; }
}
function assertItemLimit(length: number): void {
  if (length > RESOURCE_EDITOR_MAX_ITEMS) throw new ResourceEditorError("over-limit", "Resource discovery exceeds the 1000-item limit.");
}
