import type { SessionRef } from "../../../shared/apiTypes";
import { resolveAppUrl } from "../appUrl";

export function machineGitDiffPath(machineId: string, projectId: string, workspaceId: string, options?: { path?: string; staged?: boolean }): string {
  const params = new URLSearchParams();
  if (options?.path !== undefined) params.set("path", options.path);
  if (options?.staged === true) params.set("staged", "true");
  const query = params.toString();
  return `api/machines/${encodeURIComponent(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/git/diff${query ? `?${query}` : ""}`;
}

export function messagePath(session: SessionRef, options?: { limit?: number; before?: number; preview?: boolean }, machineId = "local"): string {
  const params = new URLSearchParams();
  params.set("cwd", session.cwd);
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.before !== undefined) params.set("before", String(options.before));
  if (options?.preview === true) params.set("preview", "1");
  return `api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(session.id)}/messages?${params.toString()}`;
}

export function workspaceFileWriteUrl(projectId: string, workspaceId: string, path: string, options?: { createDirs?: boolean; overwrite?: boolean; machineId?: string }): string {
  const params = new URLSearchParams({ path });
  if (options?.createDirs === false) params.set("createDirs", "false");
  if (options?.overwrite === false) params.set("overwrite", "false");
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return resolveAppUrl(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`);
}

/**
 * Rendered-document route. The file path rides in the URL path, not a query
 * parameter, so the page's relative references resolve through this same
 * route. `version` only busts the iframe's navigation cache on manual reload;
 * the server ignores it.
 */
export function workspaceDocumentPreviewUrl(projectId: string, workspaceId: string, path: string, options?: { machineId?: string; version?: number }): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const query = options?.version === undefined ? "" : `?v=${String(options.version)}`;
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return resolveAppUrl(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/preview/${encodedPath}${query}`);
}

export function workspaceImagePreviewUrl(projectId: string, workspaceId: string, path: string, options?: { modifiedAt?: string; machineId?: string }): string {
  const params = new URLSearchParams();
  params.set("path", path);
  if (options?.modifiedAt !== undefined) params.set("v", options.modifiedAt);
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return resolveAppUrl(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file/preview?${params.toString()}`);
}
