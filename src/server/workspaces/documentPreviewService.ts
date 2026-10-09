import { createReadStream, type ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { PiWebPathAccessConfig } from "../../shared/apiTypes.js";
import { MAX_DOCUMENT_PREVIEW_BYTES, MAX_DOCUMENT_PREVIEW_LABEL } from "../../shared/workspaceFiles.js";
import { DOCUMENT_PREVIEW_MIME_TYPES } from "../../shared/workspacePreviewMime.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";

/**
 * What the document preview route may serve: rendered pages plus the
 * subresource types a self-contained page references relatively (the teach
 * skill's `assets/` convention, prototype stylesheets, quiz scripts, fonts).
 * Anything else stays behind the JSON file API, so "render this workspace
 * file" can never become "download any workspace file raw".
 */
export interface WorkspaceDocumentPreview {
  path: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  stream: ReadStream;
}

export function documentMimeTypeForPath(path: string): string | undefined {
  return DOCUMENT_PREVIEW_MIME_TYPES[extname(path).toLowerCase()];
}

export async function readWorkspaceDocumentPreview(rootPath: string, path: string | undefined, pathAccess?: PiWebPathAccessConfig): Promise<WorkspaceDocumentPreview> {
  if (path === undefined || path === "") throw new Error("path is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const s = await stat(target);
  if (!s.isFile()) throw new Error("Path is not a file");
  const mimeType = documentMimeTypeForPath(displayPath);
  if (mimeType === undefined) throw new Error("Document preview is not supported for this file type");
  if (s.size > MAX_DOCUMENT_PREVIEW_BYTES) throw new Error(`Document is too large to preview (limit ${MAX_DOCUMENT_PREVIEW_LABEL})`);
  return {
    path: displayPath,
    mimeType,
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    stream: createReadStream(target),
  };
}
