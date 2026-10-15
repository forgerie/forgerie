import type { Stats } from "node:fs";
import { open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { requireActiveAgentProfile, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";

import { DECISION_GATEWAY_KEY_FILE_NAME as KEY_FILE } from "./decisions/decisionGatewayKey.js";
export class BrowserFileAccessError extends Error {
  constructor() { super("Path is outside allowed paths"); }
}

/** Browser-only exclusion. Agent tools intentionally retain their Unix-user file access.
 * Compare real paths and device/inode identities, not extensions or spelling. The
 * profile comes from sessiond, never desired config. Stat again on each use so key
 * replacement does not leave a cached inode allowlisted. Private temporary writes
 * are covered too, including aliases to those files.
 */
export class BrowserFileAccess {
  constructor(private readonly profileDir: string) {}
  async isReadable(path: string, opened?: Pick<Stats, "dev" | "ino">): Promise<boolean> {
    try {
      const profile = await existingPath(this.profileDir);
      const names = await readdir(profile).catch((error: unknown) => { if (missing(error)) return []; throw error; });
      const privatePaths = [KEY_FILE, ...names.filter(name => name.startsWith(`${KEY_FILE}.`) && name.endsWith(".tmp"))].map(name => join(profile, name));
      const candidate = await existingPath(path);
      if (privatePaths.includes(candidate)) return false;
      const identity = opened ?? await stat(candidate).catch((error: unknown) => { if (missing(error)) return undefined; throw error; });
      if (identity === undefined) return true;
      for (const privatePath of privatePaths) {
        if (await existingPath(privatePath) === candidate) return false;
        const protectedIdentity = await stat(privatePath).catch((error: unknown) => { if (missing(error)) return undefined; throw error; });
        if (protectedIdentity?.dev === identity.dev && protectedIdentity.ino === identity.ino) return false;
      }
      return true;
    } catch { throw new BrowserFileAccessError(); }
  }
  async assertReadable(path: string, opened?: Pick<Stats, "dev" | "ino">): Promise<void> {
    if (!await this.isReadable(path, opened)) throw new BrowserFileAccessError();
  }
}

export async function activeBrowserFileAccess(provider: ActiveAgentProfileProvider): Promise<BrowserFileAccess> {
  try { return new BrowserFileAccess((await requireActiveAgentProfile(provider)).dir); }
  catch { throw new BrowserFileAccessError(); }
}

/** Validate the opened inode too; a pathname check alone cannot authenticate a read. */
export async function openBrowserFile(path: string, access?: BrowserFileAccess): Promise<FileHandle> {
  await access?.assertReadable(path);
  const handle = await open(path, "r");
  try { await access?.assertReadable(path, await handle.stat()); return handle; }
  catch (error) { await handle.close(); throw error; }
}

async function existingPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!missing(error)) throw error;
    const absolute = resolve(path); const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(await existingPath(parent), basename(absolute));
  }
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
