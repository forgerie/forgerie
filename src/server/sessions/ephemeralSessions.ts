import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const EPHEMERAL_SESSIONS_DIRECTORY = "ephemeral-sessions";

/** Only a known canonical storage root is authority to permanently delete a session. */
export function isEphemeralSessionPath(path: string | undefined, root: string | undefined): boolean {
  if (path === undefined || root === undefined) return false;
  try { return contains(realpathSync(root), realpathSync(path)); }
  catch { return false; } // Unknown ownership must take the ordinary archive path, never deletion.
}

export function assertOrdinarySessionDirectory(directory: string, ephemeralRoot: string): void {
  const ordinary = canonicalFuturePath(directory);
  const ephemeral = canonicalFuturePath(ephemeralRoot);
  if (contains(ordinary, ephemeral) || contains(ephemeral, ordinary)) {
    throw new Error(`Ordinary session directory must not overlap the ephemeral session root: ${directory} (${ephemeralRoot})`);
  }
}

/** Match Pi's environment/project/global precedence without writing or migrating settings. */
export function configuredOrdinarySessionDirectory(agentDir: string, cwd: string, home: string, envDirectory: string | undefined): { source: "env" | "settings"; sessionDir: string } | undefined {
  if (envDirectory !== undefined && envDirectory !== "") return { source: "env", sessionDir: resolveConfiguredSessionDirectory(envDirectory, cwd, home) };
  const project = readSessionDirectory(join(cwd, ".pi", "settings.json"));
  const configured = project ?? readSessionDirectory(join(agentDir, "settings.json"));
  return configured === undefined || configured === "" ? undefined : { source: "settings", sessionDir: resolveConfiguredSessionDirectory(configured, cwd, home) };
}

export function resolveConfiguredSessionDirectory(path: string, cwd: string, home: string): string {
  const expanded = path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
  return resolve(cwd, expanded);
}

function readSessionDirectory(file: string): string | undefined {
  let source: string;
  try { source = readFileSync(file, "utf8"); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  const settings: unknown = JSON.parse(source.replace(/^\uFEFF/u, ""));
  if (typeof settings !== "object" || settings === null || !("sessionDir" in settings) || settings.sessionDir === undefined) return undefined;
  if (typeof settings.sessionDir !== "string") throw new Error(`Ordinary session directory must be a string: ${file}`);
  return settings.sessionDir;
}

/** Resolve existing ancestors too: configuration commonly names not-yet-created directories. */
function canonicalFuturePath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) {
    if (!missing(error)) throw error;
    try {
      if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Cannot validate an unresolved session directory link: ${absolute}`, { cause: error });
    } catch (metadataError) { if (!missing(metadataError)) throw metadataError; }
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalFuturePath(parent), basename(absolute));
  }
}
function contains(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
