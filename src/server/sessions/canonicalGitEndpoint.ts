import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Permission identity only. Git reads must still use the actual, credential-bearing push URL. */
export async function canonicalGitEndpoint(endpoint: string, cwd: string): Promise<string> {
  if (endpoint === "" || endpoint.startsWith("-") || endpoint.startsWith("~") || (endpoint.includes("\0") || /[\r\n]/u.test(endpoint))) throw new Error("Unknown Git endpoint");
  if (endpoint.startsWith("file:")) return `local:${await realpath(fileURLToPath(endpoint))}`;
  let host: string; let path: string;
  if (endpoint.includes("://")) {
    if (endpoint !== endpoint.trim()) throw new Error("Ambiguous whitespace in Git URL");
    const url = new URL(endpoint);
    if (!["ssh:", "https:", "http:", "git:"].includes(url.protocol) || url.search !== "" || url.hash !== "") throw new Error("Unknown Git URL");
    const port = (url.protocol === "ssh:" && url.port === "22") || (url.protocol === "git:" && url.port === "9418") ? "" : url.port;
    host = `${url.hostname.toLowerCase()}${port === "" ? "" : `:${port}`}`; path = url.pathname;
  } else {
    const scp = /^(?:[^/@:]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/u.exec(endpoint);
    if (scp === null) return `local:${await realpath(resolve(cwd, endpoint))}`;
    host = (scp[1] ?? "").toLowerCase(); path = scp[2] ?? "";
  }
  path = path.replace(/^\/+|\/+$/gu, "").replace(/\.git$/u, "");
  if (host === "" || /[\s/%?#@]/u.test(host) || path === "" || path.startsWith(":") || /[%?#\\\s]/u.test(path) || path.split("/").some(part => part === "." || part === "..")) throw new Error("Unknown Git repository path");
  return `network:${host}/${path}`;
}
