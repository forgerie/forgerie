import { openBrowserFile } from "../browserFileAccess.js";
import type { WorkspacePathAccess } from "./pathAccessPolicy.js";
import type { ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { IMAGE_PREVIEW_MIME_TYPES } from "../../shared/workspacePreviewMime.js";
import { MAX_IMAGE_PREVIEW_BYTES, MAX_IMAGE_PREVIEW_LABEL } from "../../shared/workspaceFiles.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";

export interface WorkspaceImagePreview {
  path: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  stream: ReadStream;
}

export function imageMimeTypeForPath(path: string): string | undefined {
  return IMAGE_PREVIEW_MIME_TYPES[extname(path).toLowerCase()];
}

export async function readWorkspaceImagePreview(rootPath: string, path: string | undefined, pathAccess?: WorkspacePathAccess): Promise<WorkspaceImagePreview> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const s = await stat(target);
  await pathAccess?.browserFiles?.assertReadable(target, s);
  if (!s.isFile()) throw new Error("Path is not a file");
  const mimeType = imageMimeTypeForPath(displayPath);
  if (mimeType === undefined) throw new Error("Image preview is not supported for this file type");
  if (s.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error(`Image is too large to preview (limit ${MAX_IMAGE_PREVIEW_LABEL})`);
  return {
    path: displayPath,
    mimeType,
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    stream: (await openBrowserFile(target, pathAccess?.browserFiles)).createReadStream(),
  };
}
