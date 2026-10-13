import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Check } from "typebox/value";
import type { Static } from "typebox";
import { projectOwnedBacklog, type BacklogConfig } from "../../shared/backlog.js";
import type { Project } from "../../shared/apiTypes.js";
import { BacklogSettingsFileSchema, BacklogSettingsV1FileSchema, GitHubLoginSchema, type BacklogSettingsFile } from "../../shared/backlogSettings.js";
import { azureSourcesOverlap, BacklogSourceCreateSchema, sourceOverlapMessage, type BacklogSource, type BacklogSourceInput } from "../../shared/backlogSources.js";
import { loadProjectPiWebConfig, parseBacklogConfig } from "../workspaces/projectPiWebConfig.js";
import { canonicalBacklogRoot } from "./backlogScanner.js";
import { assertContainedFile } from "./markdownBacklog.js";
import { isMissingFile } from "./backlogError.js";
export class BacklogSettingsConflict extends Error {}
export class BacklogSettingsUnavailable extends Error {
  constructor(cause?: unknown) {
    // JSON parser messages quote private input; report its category, not its contents.
    const detail = cause === undefined ? "" : cause instanceof SyntaxError ? " Cause: invalid JSON."
      : cause instanceof Error && "code" in cause ? ` Cause: ${String(cause.code)}.`
      : cause instanceof Error ? ` Cause: ${cause.message}.` : " Cause: unknown read failure.";
    super(`Cannot read backlog-settings.json. Restore it from a backup, or remove it to use repo-file/default backlog settings, then reload. The file has not been overwritten.${detail}`, { cause });
  }
}
/** Sessiond owns writes, including migration reads. Publish only complete snapshots. */
export class BacklogSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly deps: { projects?: () => Promise<readonly Project[]> } = {}) {}
  read(): Promise<BacklogSettingsFile> { return this.exclusive(() => this.readUnlocked()); }
  private async readUnlocked(): Promise<BacklogSettingsFile> {
    let source: string;
    try { source = await readFile(this.path, "utf8"); }
    catch (error) { if (isMissingFile(error)) return { version: 2, projects: {}, sources: {} }; throw new BacklogSettingsUnavailable(error); }
    try {
      const value: unknown = JSON.parse(source);
      if (Check(BacklogSettingsFileSchema, value)) {
        if (Object.entries(value.sources).some(([id, entry]) => id !== entry.id)) throw new Error("Source id does not match settings key");
        return value;
      }
      if (Check(BacklogSettingsV1FileSchema, value)) return await this.migrate(value, source);
      throw new Error("Invalid backlog settings file version or shape");
    } catch (error) { throw new BacklogSettingsUnavailable(error); }
  }
  save(projectId: string, backlog: BacklogConfig, baseRevision: number): Promise<void> {
    return this.exclusive(async () => {
      parseBacklogConfig(backlog, "Backlog settings");
      if (backlog.providers === undefined || backlog.providers.length === 0) throw new Error("Select at least one backlog provider.");
      if (backlog.providers.includes("azure-devops") || backlog.azureDevops !== undefined) throw new Error("Azure boards are now configured in Settings → Backlog → Sources.");
      const file = await this.readUnlocked(); this.checkRevision(file.projects, projectId, baseRevision);
      const revision = this.nextRevision(file);
      Object.defineProperty(file.projects, projectId, { value: { backlog, revision, updatedAt: new Date().toISOString() }, enumerable: true, configurable: true, writable: true });
      await this.persist(file);
    });
  }
  remove(projectId: string, baseRevision: number): Promise<void> {
    return this.exclusive(async () => { const file = await this.readUnlocked(); this.checkRevision(file.projects, projectId, baseRevision); this.nextRevision(file); file.projects = Object.fromEntries(Object.entries(file.projects).filter(([id]) => id !== projectId)); await this.persist(file); });
  }
  createSource(input: BacklogSourceInput): Promise<BacklogSource> {
    return this.exclusive(async () => { const file = await this.readUnlocked(); this.validateSource(input, file); const source: BacklogSource = { ...input, id: randomUUID(), provider: "azure-devops", revision: this.nextRevision(file), updatedAt: new Date().toISOString() }; file.sources[source.id] = source; await this.persist(file); return source; });
  }
  saveSource(id: string, input: BacklogSourceInput, baseRevision: number): Promise<BacklogSource> {
    return this.exclusive(async () => {
      const file = await this.readUnlocked(); this.checkRevision(file.sources, id, baseRevision);
      if (!Object.hasOwn(file.sources, id)) throw new BacklogSettingsConflict("The backlog source changed. Reload before saving.");
      this.validateSource(input, file, id);
      // Preserve insertion order: it is creation order and determines overlap scan precedence.
      const source: BacklogSource = { ...input, id, provider: "azure-devops", revision: this.nextRevision(file), updatedAt: new Date().toISOString() };
      file.sources[id] = source; await this.persist(file); return source;
    });
  }
  removeSource(id: string, baseRevision: number): Promise<void> {
    return this.exclusive(async () => { const file = await this.readUnlocked(); this.checkRevision(file.sources, id, baseRevision); this.nextRevision(file); file.sources = Object.fromEntries(Object.entries(file.sources).filter(([sourceId]) => sourceId !== id)); await this.persist(file); });
  }
  setGitHubLogin(login: string | null): Promise<void> {
    return this.exclusive(async () => {
      if (login !== null && !Check(GitHubLoginSchema, login)) throw new Error("Invalid GitHub username.");
      const file = await this.readUnlocked(); this.nextRevision(file); if (login === null) delete file.githubLogin; else file.githubLogin = login; await this.persist(file);
    });
  }
  private validateSource(input: BacklogSourceInput, file: BacklogSettingsFile, id?: string): void {
    if (!Check(BacklogSourceCreateSchema, input)) throw new Error("Invalid Azure DevOps source settings.");
    const overlap = Object.values(file.sources).find((other) => other.id !== id && azureSourcesOverlap(input, other));
    if (overlap !== undefined) throw new BacklogSettingsConflict(sourceOverlapMessage(overlap));
  }
  private nextRevision(file: BacklogSettingsFile): number {
    const revision = Math.max(file.revision ?? 0, ...Object.values(file.projects).map((entry) => entry.revision), ...Object.values(file.sources).map((source) => source.revision)) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error("Backlog settings revision limit reached.");
    file.revision = revision; return revision;
  }
  private checkRevision(entries: Record<string, { revision: number }>, id: string, revision: number): void {
    const entry = Object.hasOwn(entries, id) ? entries[id] : undefined;
    if (!Number.isInteger(revision) || revision < 0 || (entry?.revision ?? 0) !== revision) throw new BacklogSettingsConflict("The backlog settings changed. Reload before saving.");
  }
  private async migrate(legacy: Static<typeof BacklogSettingsV1FileSchema>, original: string): Promise<BacklogSettingsFile> {
    await this.backupV1(original);
    const file: BacklogSettingsFile = { ...legacy, version: 2, sources: {} };
    const groups = new Set<string>();
    const collect = (backlog: BacklogConfig | undefined) => {
      const azure = backlog?.azureDevops;
      if (azure === undefined) return;
      const key = JSON.stringify([azure.organization.toLowerCase(), azure.project.toLowerCase(), azure.areaPath ?? null]);
      if (groups.has(key)) return;
      groups.add(key);
      const id = randomUUID();
      file.sources[id] = { ...azure, id, provider: "azure-devops", revision: this.nextRevision(file), updatedAt: new Date().toISOString() };
    };
    for (const entry of Object.values(legacy.projects)) collect(entry.backlog);
    for (const project of await this.deps.projects?.() ?? []) {
      if (Object.hasOwn(legacy.projects, project.id)) continue;
      const repo = await canonicalBacklogRoot(project.path);
      await assertContainedFile(repo, join(repo, ".forgerie/config.json"));
      const loaded = await loadProjectPiWebConfig(repo);
      if (loaded.backlogError !== undefined) throw new Error(loaded.backlogError);
      collect(loaded.config.backlog);
    }
    file.projects = Object.fromEntries(Object.entries(legacy.projects).flatMap(([id, entry]) => {
      const enabled = entry.backlog.providers.filter((provider) => provider !== "azure-devops");
      return enabled.length === 0 ? [] : [[id, { ...entry, backlog: projectOwnedBacklog(entry.backlog) }]];
    }));
    await this.persist(file); return file;
  }
  private async backupV1(original: string): Promise<void> {
    const backup = join(dirname(this.path), "backlog-settings.v1.json");
    const existing = await stat(backup).catch((error: unknown) => { if (isMissingFile(error)) return undefined; throw error; });
    if (existing !== undefined) { if (!existing.isFile()) throw new Error("Version 1 backup is not a regular file"); return; }
    const temp = `${backup}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, original, { mode: 0o600 });
      // Publish without replacing a concurrently-created backup.
      await link(temp, backup).catch((error: unknown) => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
    } finally { await unlink(temp).catch((error: unknown) => { if (!isMissingFile(error)) throw error; }); }
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> { const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result; }
  private async persist(file: BacklogSettingsFile): Promise<void> {
    if (!Check(BacklogSettingsFileSchema, file)) throw new Error("Invalid backlog settings mutation");
    await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(file), { mode: 0o600 }); await rename(temp, this.path); }
    finally { await unlink(temp).catch((error: unknown) => { if (!isMissingFile(error)) throw error; }); }
  }
}
