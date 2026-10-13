import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Check } from "typebox/value";
import type { BacklogConfig } from "../../shared/backlog.js";
import { BacklogSettingsFileSchema, GitHubLoginSchema, type BacklogSettingsFile } from "../../shared/backlogSettings.js";
import { parseBacklogConfig } from "../workspaces/projectPiWebConfig.js";
import { isMissingFile } from "./backlogError.js";
export class BacklogSettingsConflict extends Error {}
export class BacklogSettingsUnavailable extends Error {
  constructor() { super("Cannot read backlog-settings.json. Restore it from a backup, or remove it to use repo-file/default backlog settings, then reload. The file has not been overwritten."); }
}
/** Sessiond owns writes. Failed writes leave the old complete snapshot intact. */
export class BacklogSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  async read(): Promise<BacklogSettingsFile> {
    let source: string;
    try { source = await readFile(this.path, "utf8"); } catch (error) { if (isMissingFile(error)) return { version: 1, projects: {} }; throw new BacklogSettingsUnavailable(); }
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw new BacklogSettingsUnavailable(); }
    if (!Check(BacklogSettingsFileSchema, value)) throw new BacklogSettingsUnavailable();
    return value;
  }
  save(projectId: string, backlog: BacklogConfig, baseRevision: number): Promise<void> {
    return this.exclusive(async () => {
      parseBacklogConfig(backlog, "Backlog settings");
      if (backlog.providers === undefined || backlog.providers.length === 0) throw new Error("Select at least one backlog source.");
      const file = await this.read(); this.checkRevision(file, projectId, baseRevision);
      // Keep the sequence after deletion, including across restarts. Otherwise an old tab
      // could overwrite a recreated entry whose revision had reset to 1 (the ABA problem).
      const revision = this.latestRevision(file) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error("Backlog settings revision limit reached.");
      file.revision = revision;
      Object.defineProperty(file.projects, projectId, { value: { backlog, revision, updatedAt: new Date().toISOString() }, enumerable: true, configurable: true, writable: true });
      await this.persist(file);
    });
  }
  remove(projectId: string, baseRevision: number): Promise<void> {
    return this.exclusive(async () => { const file = await this.read(); this.checkRevision(file, projectId, baseRevision); file.revision = this.latestRevision(file); file.projects = Object.fromEntries(Object.entries(file.projects).filter(([id]) => id !== projectId)); await this.persist(file); });
  }
  setGitHubLogin(login: string | null): Promise<void> {
    return this.exclusive(async () => {
      if (login !== null && !Check(GitHubLoginSchema, login)) throw new Error("Invalid GitHub username.");
      const file = await this.read(); if (login === null) delete file.githubLogin; else file.githubLogin = login; await this.persist(file);
    });
  }
  private latestRevision(file: BacklogSettingsFile): number {
    return Object.values(file.projects).reduce((latest, entry) => Math.max(latest, entry.revision), file.revision ?? 0);
  }
  private checkRevision(file: BacklogSettingsFile, id: string, revision: number): void {
    const entry = Object.hasOwn(file.projects, id) ? file.projects[id] : undefined;
    if (!Number.isInteger(revision) || revision < 0 || (entry?.revision ?? 0) !== revision) throw new BacklogSettingsConflict("The backlog settings changed. Reload before saving.");
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> { const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result; }
  private async persist(file: BacklogSettingsFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(file), { mode: 0o600 }); await rename(temp, this.path); }
    finally { await unlink(temp).catch((error: unknown) => { if (!isMissingFile(error)) throw error; }); }
  }
}
