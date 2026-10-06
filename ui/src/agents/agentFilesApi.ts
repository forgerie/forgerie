import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Dev-server API for pi-subagents agent files. The files are the only store:
 * the browser reads and writes their exact text, and pi-subagents reads them at
 * session start. Lives in the Vite server because this client has no backend of
 * its own; it moves into Forgerie's server when this client ships.
 *
 *   GET    /aui/agents                  every user and built-in agent, summarised
 *   GET    /aui/agents/<scope>/<file>   one file's exact text and its mtime
 *   PUT    /aui/agents/user/<file>      write { text, baseMtimeMs } (null base = create)
 *   DELETE /aui/agents/user/<file>?baseMtimeMs=
 */
export const AGENTS_PREFIX = "/aui/agents";
export type AgentScope = "user" | "builtin";
export interface AgentDirs { user: string; builtin: string | undefined }

export function defaultAgentDirs(root: string): AgentDirs {
  const piDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const builtin = process.env.FORGERIE_BUILTIN_AGENTS_DIR
    // This worktree sits in Forgerie's checkout, which bundles pi-subagents.
    ?? resolve(root, "../../node_modules/pi-subagents/agents");
  return { user: join(piDir, "agents"), builtin };
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A file id is a relative path without `.md`, one or more safe segments. */
function filePath(dir: string, id: string): string {
  const segments = id.split("/");
  if (segments.length === 0 || segments.some((segment) => !SEGMENT.test(segment))) throw new HttpError(400, `"${id}" is not a valid agent file name. Use letters, digits, dots, dashes, and underscores.`);
  const path = resolve(dir, `${id}.md`);
  if (!path.startsWith(resolve(dir) + sep)) throw new HttpError(400, "That path leaves the agents folder.");
  return path;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) files.push(...await walk(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** The few fields the list shows, read the way pi-subagents reads flat values. */
function summary(text: string): Record<string, string> {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return {};
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return {};
  const fields: Record<string, string> = {};
  const lines = normalized.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index++) {
    const match = /^([\w-]+):\s*(.*)$/.exec(lines[index] ?? "");
    if (!match?.[1]) continue;
    let value = (match[2] ?? "").trim();
    if (value === "" || value === "|" || value === "|-" || value === ">" || value === ">-") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^(\s+|$)/.test(lines[index + 1] ?? "") && (lines[index + 1] ?? "") !== "") block.push((lines[++index] ?? "").trim());
      value = block.join(value.startsWith("|") ? "\n" : " ");
    } else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[match[1]] = value;
  }
  return fields;
}

async function list(dirs: AgentDirs) {
  const read = async (scope: AgentScope, dir: string | undefined) => dir ? Promise.all((await walk(dir)).map(async (path) => {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const fields = summary(text);
    const file = relative(dir, path).slice(0, -".md".length).split(sep).join("/");
    return { scope, file, name: fields.name || file, description: fields.description ?? "", model: fields.model, thinking: fields.thinking,
      advertise: fields.advertise === "true", disabled: fields.disabled === "true", mtimeMs: info.mtimeMs };
  })) : [];
  const [user, builtin] = await Promise.all([read("user", dirs.user), read("builtin", dirs.builtin)]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { home: homedir(), userDir: dirs.user, agents: [...user.sort(byName), ...builtin.sort(byName)] };
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, "Agent files are limited to 1 MB.");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "The request body is not JSON."); }
}

async function mtimeOf(path: string): Promise<number | undefined> {
  try { return (await stat(path)).mtimeMs; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function handle(dirs: AgentDirs, request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://local");
  const rest = url.pathname.slice(AGENTS_PREFIX.length).replace(/^\/+/, "");
  const send = (status: number, value: unknown) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify(value));
  };
  if (rest === "") {
    if (request.method !== "GET") throw new HttpError(405, "Use GET.");
    send(200, await list(dirs));
    return;
  }
  const slash = rest.indexOf("/");
  const scope = rest.slice(0, slash);
  const id = decodeURIComponent(rest.slice(slash + 1));
  if (slash === -1 || (scope !== "user" && scope !== "builtin")) throw new HttpError(404, "No such agent scope.");
  const dir = scope === "user" ? dirs.user : dirs.builtin;
  if (!dir) throw new HttpError(404, "Built-in agents are not available on this server.");
  const path = filePath(dir, id);
  if (request.method === "GET") {
    const mtimeMs = await mtimeOf(path);
    if (mtimeMs === undefined) throw new HttpError(404, `There is no agent file "${id}".`);
    send(200, { scope, file: id, text: await readFile(path, "utf8"), mtimeMs });
    return;
  }
  if (scope !== "user") throw new HttpError(403, "Built-in agents are read-only. Customize one to make your own copy.");
  if (request.method === "PUT") {
    const input = await body(request) as { text?: unknown; baseMtimeMs?: unknown };
    if (typeof input.text !== "string") throw new HttpError(400, "Send the file text.");
    const current = await mtimeOf(path);
    if (input.baseMtimeMs === null && current !== undefined) throw new HttpError(409, `An agent file named "${id}" already exists. Choose another name.`);
    if (typeof input.baseMtimeMs === "number" && current !== input.baseMtimeMs) throw new HttpError(409, "This file changed on disk after you opened it. Reload it to see the new version.");
    await mkdir(dirname(path), { recursive: true });
    // Write beside it, then rename: a session start never reads half a file.
    const temp = `${path}.${String(process.pid)}.tmp`;
    await writeFile(temp, input.text, "utf8");
    await rename(temp, path);
    send(200, { scope, file: id, text: input.text, mtimeMs: (await stat(path)).mtimeMs });
    return;
  }
  if (request.method === "DELETE") {
    const base = Number(url.searchParams.get("baseMtimeMs"));
    const current = await mtimeOf(path);
    if (current === undefined) throw new HttpError(404, `There is no agent file "${id}".`);
    if (current !== base) throw new HttpError(409, "This file changed on disk after you opened it. Reload it before you delete it.");
    await unlink(path);
    send(200, { deleted: id });
    return;
  }
  throw new HttpError(405, "Use GET, PUT, or DELETE.");
}

export function agentFilesApi(dirs: AgentDirs): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith(AGENTS_PREFIX)) { next(); return; }
    handle(dirs, request, response).catch((error: unknown) => {
      response.statusCode = error instanceof HttpError ? error.status : 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  };
  return {
    name: "forgerie-agent-files",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
