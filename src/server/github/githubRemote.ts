import { originRemoteUrl } from "../git/originRemote.js";

const SLUG = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u;

/**
 * `owner/name` for a github.com remote URL, or undefined for any other host or shape.
 * Accepts the forms git itself writes: scp-like SSH, ssh://, https://, and git://.
 */
export function parseGitHubRemote(url: string): string | undefined {
  const value = url.trim();
  const scp = /^(?:[^@/\s]+@)?github\.com:(?<path>[^\s]+)$/iu.exec(value);
  let path: string | undefined = scp?.groups?.["path"];
  if (path === undefined) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { return undefined; }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== "github.com") return undefined;
    if (parsed.port !== "" && parsed.protocol !== "ssh:") return undefined;
    path = parsed.pathname;
  }
  const slug = path.replace(/^\/+/u, "").replace(/\/+$/u, "").replace(/\.git$/u, "");
  return SLUG.test(slug) ? slug : undefined;
}

/**
 * The GitHub repo named by the checkout's `origin` remote. Only `origin`: a fork's `upstream`
 * points at someone else's repo, and listing their issues would be a quiet surprise.
 */
export async function originGitHubRepo(repo: string): Promise<string | undefined> {
  const remote = await originRemoteUrl(repo);
  return remote === undefined ? undefined : parseGitHubRemote(remote);
}
