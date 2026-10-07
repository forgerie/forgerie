import { z } from "zod";
import { errorSchema } from "../contracts";
import { workspaceOf, type WorkspaceRef } from "../workspaceOf";
import { parseUnifiedDiff, type ParsedDiff } from "./unifiedDiff";

const fileState = z.enum(["unmodified", "modified", "added", "deleted", "renamed", "copied", "untracked", "ignored", "conflicted"]);
type FileState = z.infer<typeof fileState>;
const statusSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().optional(),
  files: z.array(z.object({ path: z.string().min(1), oldPath: z.string().optional(), index: fileState, workingTree: fileState })),
});
const diffSchema = z.object({ staged: z.boolean(), diff: z.string(), truncated: z.boolean() });

/**
 * One side of one changed file. A file changed both in the index and the
 * working tree is two entries, because git keeps two diffs for it and a note
 * names which one it read.
 */
export interface ChangeEntry {
  key: string;
  path: string;
  oldPath?: string;
  staged: boolean;
  state: Exclude<FileState, "unmodified" | "ignored">;
  /** An untracked folder has no single diff to read. */
  diffable: boolean;
}
export interface Changes { isGitRepo: boolean; branch?: string; entries: ChangeEntry[] }
export interface FileDiff extends ParsedDiff { truncated: boolean }

export function entriesOf(files: z.infer<typeof statusSchema>["files"]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  for (const file of files) {
    const sides: [boolean, FileState][] = file.index === "untracked" ? [[false, "untracked"]] : [[true, file.index], [false, file.workingTree]];
    for (const [staged, state] of sides) {
      if (state === "unmodified" || state === "ignored") continue;
      entries.push({ key: `${staged ? "staged" : "unstaged"}:${file.path}`, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}),
        staged, state, diffable: !file.path.endsWith("/") });
    }
  }
  // Paths read top to bottom like a file tree. One file's staged side comes before its unstaged side, as git applies them.
  return entries.sort((a, b) => a.path.localeCompare(b.path) || Number(b.staged) - Number(a.staged));
}

export type ChangesRequest = (path: string, init: RequestInit) => Promise<Response>;
export interface ChangesSource {
  changes(signal: AbortSignal): Promise<Changes>;
  diff(entry: ChangeEntry, signal: AbortSignal): Promise<FileDiff>;
}

/** Reads the session's git changes through its registered workspace. Read-only. */
export function createChangesSource(cwd: string, request: ChangesRequest): ChangesSource {
  let workspace: WorkspaceRef | undefined;
  async function read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    const response = await request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
    if (!response.ok) {
      const error = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${response.status}`);
    }
    return schema.parse(await response.json());
  }
  async function root(signal: AbortSignal) {
    workspace ??= await workspaceOf(cwd, read, signal).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new Error("Changes need a registered workspace for this session's folder.");
    });
    return `/api/projects/${encodeURIComponent(workspace.projectId)}/workspaces/${encodeURIComponent(workspace.workspaceId)}/git`;
  }
  return {
    async changes(signal) {
      const status = await read(`${await root(signal)}/status`, statusSchema, signal);
      return { isGitRepo: status.isGitRepo, ...(status.branch ? { branch: status.branch } : {}), entries: entriesOf(status.files) };
    },
    async diff(entry, signal) {
      const params = new URLSearchParams({ path: entry.path, staged: String(entry.staged) });
      const result = await read(`${await root(signal)}/diff?${params}`, diffSchema, signal);
      return { ...parseUnifiedDiff(result.diff), truncated: result.truncated };
    },
  };
}
