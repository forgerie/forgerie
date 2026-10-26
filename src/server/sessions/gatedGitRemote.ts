import { isAbsolute, resolve } from "node:path";

type GitRead = (cwd: string, args: readonly string[]) => Promise<string>;
export const REMOTE_HEAD_TIMEOUT_MS = 2_000;
const CACHE_MS = 3 * 60_000;

/** The same symref format that scratch_git uses. No local ref is written. */
export function remoteHeadRef(output: string): string | undefined {
  return output.split("\n").find(line => /^ref: refs\/heads\/\S+\tHEAD$/u.test(line))?.slice(5).split("\t")[0];
}

async function pushUrl(git: GitRead, cwd: string, remote: string): Promise<string> {
  if (remote === "" || remote.startsWith("-")) throw new Error("Unknown remote");
  const keys = await git(cwd, ["config", "--list", "--name-only"]);
  if (keys.split("\n").some(key => /^url\..*\.(?:pushinsteadof|insteadof)$/iu.test(key))) throw new Error("Remote URL rewrite is uncertain");
  const urls = (await git(cwd, ["remote", "get-url", "--push", "--all", remote])).trim().split("\n");
  const url = urls[0];
  if (urls.length !== 1 || url === undefined || url === "" || url.startsWith("-")) throw new Error("Remote push endpoint is uncertain");
  // Relative local remotes in two repositories must not share a cache entry.
  return !isAbsolute(url) && !url.includes(":") ? resolve(cwd, url) : url;
}

async function observe(git: GitRead, cwd: string, url: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      git(cwd, ["ls-remote", "--symref", url, "HEAD"]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error("Remote HEAD observation timed out")); }, REMOTE_HEAD_TIMEOUT_MS); timer.unref(); }),
    ]);
    const ref = remoteHeadRef(output);
    if (ref === undefined) throw new Error("Remote default branch unknown");
    return ref.slice("refs/heads/".length);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function readRemoteDefaultBranch(git: GitRead, cwd: string, remote: string): Promise<string> {
  return observe(git, cwd, await pushUrl(git, cwd, remote));
}

/** Session-owned successful observations, keyed by the one push URL. Failures never grant permission. */
export function remoteDefaultBranchReader(git: GitRead, now: () => number = Date.now): (cwd: string, remote: string) => Promise<string> {
  const cache = new Map<string, {branch: string; expires: number}>();
  return async (cwd, remote) => {
    const url = await pushUrl(git, cwd, remote);
    const cached = cache.get(url);
    if (cached !== undefined && cached.expires > now()) return cached.branch;
    const branch = await observe(git, cwd, url);
    if (cache.size >= 256) cache.delete(cache.keys().next().value ?? "");
    cache.set(url, {branch, expires: now() + CACHE_MS});
    return branch;
  };
}
