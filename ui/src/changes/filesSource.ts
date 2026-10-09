import { z } from "zod";
import { errorSchema } from "../contracts";
import { workspaceOf, type WorkspaceRef } from "../workspaceOf";
import type { ChangesRequest } from "./changesSource";
import type { Folder } from "../ui/lazyTree";
import type { Expected, LockReason, OpenedFile, SaveResult } from "../ui/textBuffers";
import type { TextFileSource } from "../ui/useTextFiles";

const treeSchema = z.object({
  entries: z.array(z.object({ name: z.string().min(1), path: z.string().min(1), type: z.enum(["file", "directory", "symlink"]) })),
  truncated: z.boolean(),
});
const fileSchema = z.object({ path: z.string(), content: z.string(), size: z.number(), truncated: z.boolean(), binary: z.boolean(), version: z.string().optional() });
const writeSchema = z.object({ version: z.string() });
const conflictSchema = z.object({ code: z.literal("conflict"), version: z.string().optional() });

/** The session's workspace as the editor's file source. */
export type FilesSource = TextFileSource;

/** Git's own folder holds no file a reader edits by hand, and writing in it can break the repository. */
const HIDDEN = new Set([".git"]);

/** Any file in the session's registered workspace, to list, read, and write. A write never replaces a change it has not seen. */
export function createFilesSource(cwd: string, request: ChangesRequest): FilesSource {
  let workspace: WorkspaceRef | undefined;
  async function send(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    return request(path, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
  }
  async function failure(response: Response): Promise<Error> {
    const error = errorSchema.safeParse(await response.json().catch(() => undefined));
    return new Error(error.success ? error.data.error : `Request failed: HTTP ${response.status}`);
  }
  async function read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    const response = await send(path, {}, signal);
    if (!response.ok) throw await failure(response);
    return schema.parse(await response.json());
  }
  async function root(signal: AbortSignal) {
    workspace ??= await workspaceOf(cwd, read, signal).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new Error("Files need a registered workspace for this session's folder.");
    });
    return `/api/projects/${encodeURIComponent(workspace.projectId)}/workspaces/${encodeURIComponent(workspace.workspaceId)}`;
  }
  return {
    async folder(path, signal): Promise<Folder> {
      const listing = await read(`${await root(signal)}/tree?${new URLSearchParams({ path })}`, treeSchema, signal);
      return {
        entries: listing.entries.filter((entry) => !HIDDEN.has(entry.name))
          .map((entry) => ({ name: entry.name, path: entry.path, type: entry.type === "directory" ? "folder" : entry.type === "symlink" ? "link" : "file" })),
        truncated: listing.truncated,
      };
    },
    async read(path, signal): Promise<OpenedFile> {
      const file = await read(`${await root(signal)}/file?${new URLSearchParams({ path })}`, fileSchema, signal);
      if (file.version !== undefined) return { type: "text", path: file.path, text: file.content, version: file.version };
      const reason: LockReason = file.binary ? "binary" : file.truncated ? "large" : "encoding";
      return { type: "locked", path: file.path, reason, size: file.size };
    },
    async write(path, text, expected: Expected, signal): Promise<SaveResult> {
      const params = new URLSearchParams({ path, createDirs: "false" });
      if (expected.type === "version") params.set("expectedVersion", expected.version);
      else params.set("overwrite", "false");
      // Bytes, not text/plain, so nothing on the way decodes or trims the text.
      const response = await send(`${await root(signal)}/file?${params}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new TextEncoder().encode(text),
      }, signal);
      if (response.status === 409) {
        const conflict = conflictSchema.safeParse(await response.clone().json().catch(() => undefined));
        if (conflict.success) return { type: "conflict", version: conflict.data.version };
      }
      if (!response.ok) throw await failure(response);
      return { type: "saved", version: writeSchema.parse(await response.json()).version };
    },
  };
}
