/**
 * A path a reply names, as a path inside the workspace at `cwd`. Replies
 * mostly name paths from the workspace root, but some name them from the
 * filesystem root. A `files` block drops the leading slash, so the workspace
 * folder can arrive with or without it.
 */
export function workspacePath(cwd: string, path: string): string {
  const root = cwd.replace(/\/+$/u, "").replace(/^\/+/u, "");
  let inside = path.trim().replace(/^\/+/u, "");
  if (root !== "" && inside.startsWith(`${root}/`)) inside = inside.slice(root.length + 1);
  while (inside.startsWith("./")) inside = inside.slice(2);
  return inside;
}
