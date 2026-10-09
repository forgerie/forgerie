import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { pathInside } from "../workspaces/sessionWorktreeStore.js";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import type { Project, SessionRef } from "../../shared/apiTypes.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import { cwdPathsEqual } from "../workingDirectory.js";
import type { ProjectService } from "./projectService.js";
import type { ProjectGroups } from "./projectGroups.js";
import type { WorkspaceService } from "../workspaces/workspaceService.js";
import type { SessionWorktrees } from "../workspaces/sessionWorktrees.js";

interface Dependencies {
  projects: Pick<ProjectService, "list" | "requireProject">;
  groups: Pick<ProjectGroups, "list">;
  workspaces: Pick<WorkspaceService, "list">;
  worktrees: SessionWorktrees;
  agentDir: string;
  writable(ref: SessionRef): Promise<boolean>;
}
/** Resolves secondary checkouts without changing the chat's cwd or starting another agent. */
export class ProjectWorkspaces {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: Dependencies) {}

  async catalog(ref: SessionRef) {
    const projects = await this.deps.projects.list();
    const home = await this.home(ref.cwd, projects);
    const groups = (await this.deps.groups.list()).filter((group) => home !== undefined && group.projectIds.includes(home.id));
    const members = new Set(groups.flatMap((group) => group.projectIds));
    if (home !== undefined) members.add(home.id);
    return { home, groups, projects: projects.filter((project) => members.has(project.id)), related: await this.related(ref) };
  }
  async related(ref?: SessionRef) {
    const records = (await this.deps.worktrees.store.list()).filter((record) => record.relatedSession !== undefined
      && (ref === undefined || sameOwner(record, ref)));
    return Promise.all(records.map((record) => this.deps.worktrees.info(record, ref?.id ?? record.relatedSession?.id ?? "")));
  }
  async context(ref: SessionRef, projectId: string) {
    const project = await this.target(ref, projectId);
    const owned = (await this.deps.worktrees.store.list()).find((record) => sameOwner(record, ref) && record.relatedSession?.projectId === projectId && record.state.kind === "active" && record.setup.phase === "done");
    const cwd = owned?.path ?? project.path;
    let remaining = 32_000;
    const instructions = loadProjectContextFiles({ cwd, agentDir: this.deps.agentDir }).map((file) => {
      const content = file.content.slice(0, Math.max(0, remaining));
      remaining -= content.length;
      return { path: file.path, content, truncated: content.length !== file.content.length };
    });
    return { project, cwd, worktreeId: owned?.id, instructions,
      guidance: "Keep this chat's cwd unchanged. Read the target instructions before edits. Use absolute paths in read/edit/write and git -C or a command cwd for this checkout. Prepare a managed worktree before changing another repo. No target extensions or settings are loaded into this session." };
  }
  prepare(ref: SessionRef, projectId: string, requestId: string): Promise<SessionWorktreeRecord> {
    const operation = this.queue.then(async () => {
      if (!await this.deps.writable(ref)) throw new Error("Use a writable, unarchived session and its full ID and cwd.");
      const project = await this.target(ref, projectId);
      if (!requestId.trim() || requestId.length > 256) throw new Error("A stable requestId is required.");
      const token = `related-${createHash("sha256").update(JSON.stringify([ref.id, ref.cwd, requestId])).digest("hex")}`;
      const records = await this.deps.worktrees.store.list();
      const previous = records.find((record) => record.startupToken === token);
      if (previous !== undefined && (!sameOwner(previous, ref) || previous.relatedSession?.projectId !== projectId)) throw new Error("requestId was already used for another project.");
      // Reuse only a checkout this exact chat owns. Never take another session's work.
      const existing = previous ?? records.find((record) => sameOwner(record, ref) && record.relatedSession?.projectId === projectId && record.state.kind === "active");
      if (existing !== undefined && (existing.setup.phase === "done" || existing.state.kind !== "active")) return existing;
      return this.deps.worktrees.create(project.path, token, existing?.id, { id: ref.id, cwd: ref.cwd, projectId });
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async requireOwned(ref: SessionRef, id: string): Promise<SessionWorktreeRecord> {
    const record = await this.deps.worktrees.store.require(id);
    if (!sameOwner(record, ref)) throw new Error("This worktree belongs to another session.");
    return record;
  }
  async assertWritable(ref: SessionRef): Promise<void> {
    if (!await this.deps.writable(ref)) throw new Error("The owning session is not writable.");
  }
  async toolCwd(ref: SessionRef, id: string): Promise<string> {
    await this.assertWritable(ref);
    const record = await this.requireOwned(ref, id);
    if (record.state.kind !== "active" || record.setup.phase !== "done") throw new Error("The target worktree is not ready.");
    const info = await this.deps.worktrees.info(record, ref.id);
    if (info.statusError !== undefined) throw new Error(info.statusError);
    return record.path;
  }
  /** PR operations use the target cwd; their notifications still return to the original chat. */
  async owner(ref: SessionRef): Promise<{ ref: SessionRef; active: boolean }> {
    const record = (await this.deps.worktrees.store.list()).find((item) => item.relatedSession?.id === ref.id && cwdPathsEqual(item.path, ref.cwd));
    return record?.relatedSession === undefined ? { ref, active: true } : {
      ref: { id: record.relatedSession.id, cwd: record.relatedSession.cwd }, active: record.state.kind === "active" && record.setup.phase === "done",
    };
  }
  private async target(ref: SessionRef, id: string): Promise<Project> {
    // Existing attachments remain inspectable after organizational changes.
    const attached = (await this.related(ref)).some((record) => record.relatedSession?.projectId === id);
    const project = (await this.catalog(ref)).projects.find((item) => item.id === id);
    if (project !== undefined) return project;
    if (attached) return this.deps.projects.requireProject(id);
    throw new Error("Choose a registered project in a group shared with this session's project.");
  }
  private async home(cwd: string, projects: Project[]): Promise<Project | undefined> {
    const canonical = await realpath(cwd).catch(() => cwd);
    for (const project of [...projects].sort((a, b) => b.path.length - a.path.length)) {
      if ((await this.deps.workspaces.list(project)).some((workspace) => cwdPathsEqual(workspace.path, canonical) || pathInside(workspace.path, canonical))) return project;
    }
    return undefined;
  }
}
function sameOwner(record: SessionWorktreeRecord, ref: SessionRef): boolean {
  return record.relatedSession?.id === ref.id && cwdPathsEqual(record.relatedSession.cwd, ref.cwd);
}
