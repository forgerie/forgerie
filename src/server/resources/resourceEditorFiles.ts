import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { RESOURCE_EDITOR_MAX_BYTES, type ResourceEditorErrorResponse } from "../../shared/resourceEditor.js";

export class ResourceEditorError extends Error {
  constructor(readonly kind: ResourceEditorErrorResponse["error"]["kind"], message: string, readonly savedToDisk = false) { super(message); }
}

export function resourceHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export function insideResourceRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export interface ResourceFileContents { text: string; revision: string; canonicalPath: string; mode: number }

/** Reads the real file, but never follows a final symlink after opening it. */
export async function readResourceFile(path: string): Promise<ResourceFileContents> {
  const canonicalPath = await realpath(path);
  const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new ResourceEditorError("read-only", "This resource is not a regular file.");
    if (before.size > RESOURCE_EDITOR_MAX_BYTES) throw new ResourceEditorError("over-limit", "Resource files are limited to 1 MiB.");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    if (length > RESOURCE_EDITOR_MAX_BYTES) throw new ResourceEditorError("over-limit", "Resource files are limited to 1 MiB.");
    if (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || length !== before.size) throw new ResourceEditorError("conflict", "This file changed while it was read. Read it again.");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)); }
    catch { throw new ResourceEditorError("read-only", "This resource is not valid UTF-8 text."); }
    if (text.includes("\0")) throw new ResourceEditorError("read-only", "Binary resources are not editable.");
    return { text, canonicalPath, mode: before.mode & 0o777, revision: resourceHash(`${String(before.dev)}:${String(before.ino)}:${String(before.mtimeMs)}:${String(before.ctimeMs)}:${text}`) };
  } finally { await handle.close(); }
}

/** The configured root is the authority, not a symlink target discovered below it. */
export async function writableResourcePath(path: string, root: string): Promise<string> {
  const [file, canonicalPath, canonicalRoot] = await Promise.all([lstat(path), realpath(path), realpath(root)]);
  if (file.isSymbolicLink() || !file.isFile()) throw new ResourceEditorError("read-only", "Linked resource files are read-only.");
  if (!insideResourceRoot(canonicalPath, canonicalRoot)) throw new ResourceEditorError("read-only", "This resource links outside its configured folder.");
  if (file.nlink > 1) throw new ResourceEditorError("read-only", "Hard-linked resource files are read-only.");
  await access(canonicalPath, constants.W_OK);
  await access(dirname(canonicalPath), constants.W_OK);
  return canonicalPath;
}

export async function writeResourceFile(path: string, root: string, expected: ResourceFileContents, text: string): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > RESOURCE_EDITOR_MAX_BYTES) throw new ResourceEditorError("over-limit", "Resource files are limited to 1 MiB.");
  if (text.includes("\0")) throw new ResourceEditorError("invalid-request", "Resource files must be text without NUL characters.");
  const target = await writableResourcePath(path, root);
  if (target !== expected.canonicalPath) throw new ResourceEditorError("conflict", "The resource moved. Read it again.");
  const temporary = join(dirname(target), `.forgerie-resource-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", expected.mode);
    try {
      await handle.writeFile(text, "utf8");
      await handle.chmod(expected.mode);
      await handle.sync();
    } finally { await handle.close(); }
    if (await writableResourcePath(path, root) !== target || (await readResourceFile(path)).revision !== expected.revision) throw new ResourceEditorError("conflict", "This file changed on disk. Read it again before saving.");
    await rename(temporary, target);
  } finally { await unlink(temporary).catch((error: unknown) => { if (!isMissingResource(error)) throw error; }); }
}

export function isMissingResource(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
