import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { originRemoteUrl } from "../git/originRemote.js";

const execute = promisify(execFile);
export interface AzureRepo { organization: string; project: string; repository: string }

/** Only recognized Azure origin shapes; decoded segments never become path separators. */
export function parseAzureRemote(remote: string): AzureRepo | undefined {
  const value = remote.trim();
  let segments: string[];
  const ssh = /^(?:git@ssh\.dev\.azure\.com|[^@/\s]+@vs-ssh\.visualstudio\.com):v3\/([^\s]+)$/iu.exec(value);
  if (ssh?.[1] !== undefined) segments = ssh[1].split("/");
  else {
    let url: URL;
    try { url = new URL(value); } catch { return undefined; }
    if (url.protocol !== "https:" || url.port !== "" || url.search !== "" || url.hash !== "") return undefined;
    const path = url.pathname.slice(1).split("/");
    if (url.hostname.toLowerCase() === "dev.azure.com") {
      if (path.length !== 4 || path[2] !== "_git") return undefined;
      segments = [path[0] ?? "", path[1] ?? "", path[3] ?? ""];
    } else {
      const legacy = /^([a-z0-9-]+)\.visualstudio\.com$/iu.exec(url.hostname);
      if (legacy?.[1] === undefined) return undefined;
      if (path[0] === "DefaultCollection") path.shift();
      if (path.length !== 3 || path[1] !== "_git") return undefined;
      segments = [legacy[1], path[0] ?? "", path[2] ?? ""];
    }
  }
  if (segments.length !== 3) return undefined;
  try {
    const [organization = "", project = "", repository = ""] = segments.map(decodeURIComponent);
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/iu.test(organization) || [project, repository].some((part) => part === "" || part === "." || part === ".." || /[/\\\p{Cc}]/u.test(part))) return undefined;
    return { organization, project, repository };
  } catch { return undefined; }
}

export async function originAzureRepo(cwd: string): Promise<AzureRepo | undefined> {
  const remote = await originRemoteUrl(cwd);
  return remote === undefined ? undefined : parseAzureRemote(remote);
}

export const azureRepoKey = (repo: AzureRepo): string => `${repo.organization}/${repo.project}/${repo.repository}`;
export async function azureSourceBranch(cwd: string): Promise<string> {
  const { stdout } = await execute("git", ["-C", cwd, "symbolic-ref", "--quiet", "--short", "HEAD"], { env: sanitizedGitEnv() });
  return stdout.trim();
}
