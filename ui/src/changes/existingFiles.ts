import type { FilesSource } from "./filesSource";

/**
 * How long one folder listing answers for the files in it. A transcript that
 * loads with many file lists asks for the same folders at once; any longer
 * and a file the agent wrote since would not become a link.
 */
export const LISTING_LIFETIME_MS = 2_000;

/**
 * Which of the paths a reply names are files in the workspace now. Each path
 * is looked up in its folder's listing, so a reply costs one request per
 * folder, and replies that load together share them. A folder that cannot be
 * listed, such as one outside the workspace, has no files. `toWorkspace`
 * turns a path as the reply wrote it into one inside the workspace.
 */
export function existingFiles(source: Pick<FilesSource, "folder">, toWorkspace: (path: string) => string, now: () => number = Date.now) {
  const listings = new Map<string, { at: number; files: Promise<ReadonlySet<string>> }>();
  const filesIn = (folder: string) => {
    const known = listings.get(folder);
    if (known && now() - known.at < LISTING_LIFETIME_MS) return known.files;
    // Shared by every caller, so no one caller's abort cancels it.
    const files = source.folder(folder, new AbortController().signal).then(
      (listing): ReadonlySet<string> => new Set(listing.entries.filter((entry) => entry.type !== "folder").map((entry) => entry.path)),
      (): ReadonlySet<string> => new Set());
    listings.set(folder, { at: now(), files });
    return files;
  };
  return async (paths: readonly string[], signal: AbortSignal): Promise<ReadonlySet<string>> => {
    const found = new Set<string>();
    await Promise.all(paths.map(async (path) => {
      const inside = toWorkspace(path);
      if (inside === "" || inside.split("/").includes("..")) return;
      const slash = inside.lastIndexOf("/");
      if ((await filesIn(slash < 0 ? "" : inside.slice(0, slash))).has(inside)) found.add(path);
    }));
    signal.throwIfAborted();
    return found;
  };
}
