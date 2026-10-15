import { openBrowserFile, type BrowserFileAccess } from "../browserFileAccess.js";
import type { WorkspacePathAccess } from "./pathAccessPolicy.js";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DeleteWorkspaceFileResponse, FileContentResponse, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse } from "../../shared/apiTypes.js";
import { imageMimeTypeForPath } from "./imagePreviewService.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";
import { ensureInside, isNodeErrorWithCode, normalizeRelativePath, resolveInsideWorkspace, resolveParentInsideWorkspace } from "./pathSafety.js";

const MAX_BYTES = 512 * 1024;

/** A file's bytes as one value, so a writer can tell whether the file changed since it was read. */
export function contentVersion(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Streamed, so a file an agent made huge is not read into memory to be compared.
async function fileVersion(target: string, access?: BrowserFileAccess): Promise<string> {
  const hash = createHash("sha256");
  const stream = (await openBrowserFile(target, access)).createReadStream();
  stream.on("data", (chunk) => hash.update(chunk));
  await new Promise<void>((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); });
  return hash.digest("hex");
}

/** A write's `expectedVersion` no longer matches the file on disk. `version` is what the disk holds now, absent when the file is gone. */
export class WorkspaceFileConflictError extends Error {
  constructor(readonly path: string, readonly version: string | undefined) {
    super(version === undefined ? `${path} was deleted after it was read` : `${path} changed after it was read`);
    this.name = "WorkspaceFileConflictError";
  }
}

export async function readWorkspaceFile(rootPath: string, path: string | undefined, pathAccess?: WorkspacePathAccess): Promise<FileContentResponse> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const s = await stat(target);
  await pathAccess?.browserFiles?.assertReadable(target, s);
  if (!s.isFile()) throw new Error("Path is not a file");
  const bytesToRead = Math.min(s.size, MAX_BYTES);
  const buffer = await readFilePrefix(target, bytesToRead, pathAccess?.browserFiles);
  const media = mediaForPath(displayPath);
  const binary = media.mediaType === "image" || isProbablyBinary(buffer);
  const truncated = s.size > MAX_BYTES;
  // Text that does not survive a UTF-8 round trip would be changed by an editor that saves it back.
  const editable = !binary && !truncated && Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
  return {
    path: displayPath,
    ...languageForPath(displayPath),
    ...media,
    encoding: "utf8",
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    content: binary ? "" : buffer.toString("utf8"),
    truncated,
    binary,
    ...editable ? { version: contentVersion(buffer) } : {},
  };
}

async function readFilePrefix(target: string, bytesToRead: number, access?: BrowserFileAccess): Promise<Buffer> {
  if (bytesToRead === 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await openBrowserFile(target, access);
  try {
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

export async function writeWorkspaceFile(rootPath: string, path: string | undefined, content: Buffer, options: WriteWorkspaceFileOptions = {}, access?: BrowserFileAccess): Promise<WriteWorkspaceFileResponse> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");

  const createDirs = options.createDirs ?? true;
  const overwrite = options.overwrite ?? true;

  let exists = false;
  try {
    const { target, relativePath } = await resolveInsideWorkspace(rootPath, path);
    await access?.assertReadable(target);
    const s = await stat(target);
    if (!s.isFile()) throw new Error("Path is not a file");
    if (!overwrite) throw new Error(`File already exists: ${relativePath}`);
    exists = true;
    if (options.expectedVersion !== undefined) {
      const current = await fileVersion(target, access);
      if (current !== options.expectedVersion) throw new WorkspaceFileConflictError(relativePath, current);
    }
  } catch (error: unknown) {
    if (error instanceof WorkspaceFileConflictError) throw error;
    if (error instanceof Error && error.message.startsWith("File already exists")) throw error;
    if (isNodeErrorWithCode(error, "ENOENT")) { /* expected for creation — continue */ }
    else if (error instanceof Error && error.message === "Path does not exist") { /* expected for creation — continue */ }
    else throw error; // re-throw permission errors, "not a file", traversal errors, etc.
  }
  // The reader saw a file that is gone now. Writing would bring it back unasked.
  if (!exists && options.expectedVersion !== undefined) throw new WorkspaceFileConflictError(normalizeRelativePath(path), undefined);

  // Use resolveParentInsideWorkspace for the actual write since the target may not exist yet
  const { root, target, relativePath } = await resolveParentInsideWorkspace(rootPath, path);

  if (createDirs) await mkdir(dirname(target), { recursive: true });

  // Resolve symlinks in the parent path to prevent escape via symlink
  const realParent = await realpath(dirname(target));
  const realTarget = join(realParent, basename(target));
  ensureInside(root, realTarget);
  await access?.assertReadable(realTarget);
  await writeFile(realTarget, content);

  const s = await stat(realTarget);
  return {
    path: relativePath,
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    created: !exists,
    version: contentVersion(content),
  };
}

export async function deleteWorkspaceFile(rootPath: string, path: string | undefined, access?: BrowserFileAccess): Promise<DeleteWorkspaceFileResponse> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  // Use resolveParentInsideWorkspace + lstat so that deleting a symlink
  // deletes the symlink itself, not the target it points to.
  // resolveInsideWorkspace would call realpath on the target, following
  // symlinks and resolving the symlink's destination instead.
  const { root, target, relativePath } = await resolveParentInsideWorkspace(rootPath, path);
  try {
    // Resolve symlinks in the parent path to prevent escape via a symlinked
    // parent directory. The final path component is intentionally NOT resolved
    // so that lstat/unlink act on the entry itself (deleting a symlink rather
    // than the file it points to).
    const realParent = await realpath(dirname(target));
    const realTarget = join(realParent, basename(target));
    ensureInside(root, realTarget);
    await access?.assertReadable(realTarget);
    const s = await lstat(realTarget);
    // Allow deleting regular files and symlinks, but not directories
    if (s.isDirectory()) throw new Error("Path is a directory, use directory deletion instead");
    await unlink(realTarget);
    return { path: relativePath, existed: true };
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return { path: relativePath, existed: false };
    if (error instanceof Error && error.message === "Path does not exist") return { path: relativePath, existed: false };
    throw error;
  }
}

export async function moveWorkspaceFile(rootPath: string, fromPath: string | undefined, toPath: string | undefined, options: MoveWorkspaceFileOptions = {}, access?: BrowserFileAccess): Promise<MoveWorkspaceFileResponse> {
  if (fromPath === undefined || fromPath === "") throw new Error("fromPath query parameter is required");
  if (toPath === undefined || toPath === "") throw new Error("toPath query parameter is required");

  const createDirs = options.createDirs ?? true;
  const overwrite = options.overwrite ?? false;

  // Source: must exist and be a file (uses realpath via resolveInsideWorkspace)
  const { target: source, relativePath: fromRelative } = await resolveInsideWorkspace(rootPath, fromPath);
  await access?.assertReadable(source);
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error("Source path is not a file");

  // Target: uses resolveParentInsideWorkspace + realpath(dirname) pattern (same as writeFile)
  const { root, target: dest, relativePath: destRelative } = await resolveParentInsideWorkspace(rootPath, toPath);

  if (createDirs) await mkdir(dirname(dest), { recursive: true });

  // Resolve symlinks in the parent path to prevent escape via symlink
  const realParent = await realpath(dirname(dest));
  const realDest = join(realParent, basename(dest));
  ensureInside(root, realDest);

  if (!overwrite) {
    try {
      const destStat = await stat(realDest);
      if (destStat.isFile()) throw new Error(`File already exists: ${destRelative}`);
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) { /* expected — target doesn't exist */ }
      else if (error instanceof Error && error.message.startsWith("File already exists")) throw error;
      else throw error;
    }
  }

  await access?.assertReadable(realDest);
  await rename(source, realDest);
  const finalStat = await stat(realDest);
  return { fromPath: fromRelative, toPath: destRelative, size: finalStat.size, modifiedAt: finalStat.mtime.toISOString() };
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function languageForPath(path: string): { language?: string } {
  const ext = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string | undefined> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  const language = ext === undefined ? undefined : languages[ext];
  return language === undefined ? {} : { language };
}

function mediaForPath(path: string): { mediaType?: "image"; mimeType?: string } {
  const mimeType = imageMimeTypeForPath(path);
  return mimeType === undefined ? {} : { mediaType: "image", mimeType };
}
