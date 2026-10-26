import { remoteHeadRef } from "./gatedGitRemote.js";
import { mkdir, readFile, realpath, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalGitEndpoint } from "./canonicalGitEndpoint.js";
import { backUpWorktree, isManagedWorktree, type ProjectWorktreeBackup } from "./disposableWorktrees.js";

/**
 * Scratch Git work that Forgerie created for an agent family, through the `scratch_git` tool.
 *
 * Ownership is a fact, not an inference: Forgerie ran the creating Git command itself and saw it succeed. Nothing is
 * recorded from Bash. Each record keeps an identity that a delete-and-recreate cannot reproduce, so a user's tree or
 * branch with the same name never inherits ownership.
 */

/** Throwaway trees go here, one folder per agent family. Fixed, so a changed TMPDIR cannot move it. */
export const SCRATCH_GIT_ROOT = "/tmp/forgerie-scratch";

/* eslint-disable @typescript-eslint/consistent-type-definitions -- Durable documents need JSON-compatible type aliases. */
export type ScratchTree = {
  name: string;
  kind: "worktree" | "clone";
  path: string;
  /** The main checkout of the repository that holds the tree's Git data. For a clone, the clone itself. */
  repo: string;
  /** The repository's common Git directory, as a real path. */
  common: string;
  identity: string;
  /** A branch the same `create_worktree` call made, with its creation identity. Absent identity: never deleted for the agent. */
  branch?: { ref: string; identity?: string };
  conversation: number;
  at: number;
};
export type ScratchRemoteRef = {
  /** Canonical endpoint: permission identity only. Git reads and pushes use `url`. */
  endpoint: string;
  url: string;
  /** A repository folder to run remote commands from. */
  repo: string;
  ref: string;
  sha: string;
  conversation: number;
  at: number;
};
export type ScratchLedger = {
  /** This family's folder name under the scratch root, chosen at the first creation. */
  root?: string;
  trees: Record<string, ScratchTree>;
  remotes: ScratchRemoteRef[];
};
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export interface ScratchGitDeps {
  /** Runs Git without a shell. Rejects on a non-zero exit. */
  git: (cwd: string, args: readonly string[]) => Promise<string>;
  backup: ProjectWorktreeBackup;
  scratchRoot: string;
  now(): number;
}

/** A refusal the agent can read and act on. Anything else is an unexpected failure. */
export class ScratchGitRefusal extends Error {}
const refuse = (message: string): never => { throw new ScratchGitRefusal(message); };

/** What one action changes in the ledger. The caller commits it after the Git effect. */
export interface ScratchLedgerChange {
  addTree?: ScratchTree;
  retireTrees?: readonly string[];
  addRemote?: ScratchRemoteRef;
  retireRemotes?: readonly ScratchRemoteRef[];
}
export interface ScratchGitOutcome { text: string; change: ScratchLedgerChange }

export function applyScratchChange(ledger: ScratchLedger, change: ScratchLedgerChange): void {
  for (const name of change.retireTrees ?? []) Reflect.deleteProperty(ledger.trees, name);
  if (change.addTree !== undefined) ledger.trees[change.addTree.name] = change.addTree;
  const retired = new Set((change.retireRemotes ?? []).map(remoteKey));
  ledger.remotes = ledger.remotes.filter(remote => !retired.has(remoteKey(remote)));
  if (change.addRemote !== undefined) ledger.remotes.push(change.addRemote);
}
const remoteKey = (remote: Pick<ScratchRemoteRef, "endpoint" | "ref" | "sha">) => JSON.stringify([remote.endpoint, remote.ref, remote.sha]);

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const gitLine = (output: string) => output.replace(/\n$/u, "");
const errorCode = (error: unknown) => error instanceof Error && "code" in error ? error.code : undefined;
/** Whether a real path is strictly inside the scratch root. A missing root holds nothing. */
async function inScratch(deps: ScratchGitDeps, path: string): Promise<boolean> {
  const root = await realpath(deps.scratchRoot).catch(() => undefined);
  if (root === undefined) return false;
  const part = relative(root, path);
  return part !== "" && !isAbsolute(part) && part.split(sep)[0] !== "..";
}

async function fileIdentity(path: string): Promise<string> {
  const value = await stat(path, { bigint: true });
  if (value.birthtimeNs <= 0n) throw new Error(`No creation time for ${path}`);
  return `${String(value.dev)}:${String(value.ino)}:${String(value.birthtimeNs)}`;
}

/** Device, inode and creation time of the tree and its Git directory, plus the worktree's `.git` link. */
export async function treeIdentity(git: ScratchGitDeps["git"], path: string): Promise<string> {
  const real = await realpath(path);
  if (await realpath(gitLine(await git(real, ["rev-parse", "--show-toplevel"]))) !== real) throw new Error(`${path} is not a repository top level`);
  const gitDir = await realpath(gitLine(await git(real, ["rev-parse", "--absolute-git-dir"])));
  const link = await readFile(join(real, ".git"), "utf8").catch((error: unknown) => { if (errorCode(error) === "EISDIR") return "directory"; throw error; });
  return JSON.stringify([await fileIdentity(real), gitDir, await fileIdentity(gitDir), link]);
}

/** The branch's reflog file and its first entry. Deleting a branch deletes its reflog, so a recreated branch differs. */
export async function branchIdentity(git: ScratchGitDeps["git"], cwd: string, ref: string): Promise<string> {
  const log = gitLine(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", `logs/${ref}`]));
  const first = (await readFile(log, "utf8")).split("\n")[0] ?? "";
  if (!/^[0-9a-f]{40,64} [0-9a-f]{40,64} .+\t/u.test(first)) throw new Error(`No creation entry in the reflog of ${ref}`);
  return JSON.stringify([await fileIdentity(log), first]);
}

async function sameTree(git: ScratchGitDeps["git"], tree: ScratchTree): Promise<boolean> {
  try { return await treeIdentity(git, tree.path) === tree.identity; } catch { return false; }
}
async function sameBranch(git: ScratchGitDeps["git"], cwd: string, branch: ScratchTree["branch"]): Promise<boolean> {
  if (branch?.identity === undefined) return false;
  try { return await branchIdentity(git, cwd, branch.ref) === branch.identity; } catch { return false; }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) { if (errorCode(error) === "ENOENT") return false; throw error; }
}

/**
 * Makes the tree's folder. `mkdir` fails when the path exists, so no one else's work can be inside it. Scratch
 * folders are private to the user; a project's `.worktree` folder keeps the default mode.
 */
async function claimFolder(path: string, scratch: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true, ...(scratch ? { mode: 0o700 } : {}) });
  try { await mkdir(path, scratch ? { mode: 0o700 } : {}); }
  catch (error) { if (errorCode(error) === "EEXIST") refuse(`${path} already exists; pick another name`); throw error; }
}

function checkName(ledger: ScratchLedger, name: string): void {
  if (!NAME.test(name) || isManagedWorktree(name)) refuse(`name must be 1-64 letters, digits, dot, dash or underscore, and not a Forgerie session or child worktree name; got ${name}`);
  if (Object.hasOwn(ledger.trees, name)) refuse(`${name} already names a scratch tree; remove it or pick another name`);
}
function checkRevision(value: string | undefined, label: string): void {
  if (value !== undefined && (value === "" || value.startsWith("-") || /[\s\0]/u.test(value))) refuse(`${label} must be a revision without spaces that does not start with -; got ${value}`);
}

/** The main checkout and common Git directory of a non-bare repository. */
async function repository(git: ScratchGitDeps["git"], folder: string): Promise<{ main: string; common: string }> {
  const common = await realpath(gitLine(await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  if (basename(common) !== ".git") refuse(`${folder} has no main checkout (bare or unusual layout)`);
  return { main: dirname(common), common };
}

export interface CreateWorktreeArgs { repo: string; name: string; ref?: string; branch?: string; place?: "scratch" | "project" }
export async function createWorktree(deps: ScratchGitDeps, ledger: ScratchLedger, root: string, args: CreateWorktreeArgs, conversation: number): Promise<ScratchGitOutcome> {
  checkName(ledger, args.name);
  checkRevision(args.ref, "ref");
  const { main, common } = await repository(deps.git, args.repo);
  if (args.branch !== undefined) {
    if (args.branch.startsWith("-")) refuse(`branch must not start with -; got ${args.branch}`);
    await deps.git(main, ["check-ref-format", "--branch", args.branch]).catch(() => refuse(`${args.branch ?? ""} is not a valid branch name`));
  }
  const path = args.place === "project" ? join(main, ".worktree", args.name) : join(deps.scratchRoot, root, args.name);
  await claimFolder(path, args.place !== "project");
  try {
    // Run from the folder the agent named, so a worktree without `ref` starts at that folder's HEAD.
    await deps.git(args.repo, ["worktree", "add", "--quiet", ...(args.branch === undefined ? ["--detach"] : ["-b", args.branch]), "--", path, ...(args.ref === undefined ? [] : [args.ref])]);
  } catch (error) {
    // Only the empty folder this call made. A non-empty folder means Git wrote something; leave it for the user.
    await rmdir(path).catch(() => undefined);
    throw error;
  }
  const ref = args.branch === undefined ? undefined : `refs/heads/${args.branch}`;
  // Git refused `-b` for an existing branch, so a branch here is one this call created.
  const branch = ref === undefined ? undefined : { ref, ...await branchIdentity(deps.git, path, ref).then(identity => ({ identity }), () => ({})) };
  const tree: ScratchTree = { name: args.name, kind: "worktree", path: await realpath(path), repo: main, common, identity: await treeIdentity(deps.git, path),
    ...(branch === undefined ? {} : { branch }), conversation, at: deps.now() };
  const note = branch !== undefined && branch.identity === undefined ? ` The branch has no reflog, so remove keeps ${args.branch ?? ""}.` : "";
  return { text: `Created worktree ${args.name} at ${tree.path}${args.branch === undefined ? " (detached)" : ` on new branch ${args.branch}`}.${note}`, change: { addTree: tree } };
}

export interface CloneArgs { source: string; name: string; ref?: string; shared?: boolean }
export async function cloneRepository(deps: ScratchGitDeps, ledger: ScratchLedger, root: string, args: CloneArgs, cwd: string, conversation: number): Promise<ScratchGitOutcome> {
  checkName(ledger, args.name);
  checkRevision(args.ref, "ref");
  if (args.source === "" || args.source.startsWith("-") || /[\0\r\n]/u.test(args.source)) refuse(`source must be a path or URL that does not start with -; got ${args.source}`);
  const local = resolve(cwd, args.source);
  const source = await exists(local) ? await realpath(local) : args.source;
  const path = join(deps.scratchRoot, root, args.name);
  await claimFolder(path, true);
  try { await deps.git(cwd, ["clone", "--quiet", ...(args.shared === true ? ["--shared"] : []), "--", source, path]); }
  catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  const common = await realpath(join(path, ".git"));
  const tree: ScratchTree = { name: args.name, kind: "clone", path: await realpath(path), repo: await realpath(path), common, identity: await treeIdentity(deps.git, path), conversation, at: deps.now() };
  const outcome = { text: `Cloned ${source} into ${tree.path}.`, change: { addTree: tree } };
  if (args.ref === undefined) return outcome;
  try { await deps.git(path, ["checkout", "--quiet", "--detach", args.ref]); }
  catch (error) { return { ...outcome, text: `${outcome.text} Checking out ${args.ref} failed: ${error instanceof Error ? error.message : String(error)}` }; }
  return { ...outcome, text: `${outcome.text} Checked out ${args.ref}.` };
}

export async function removeTree(deps: ScratchGitDeps, ledger: ScratchLedger, name: string): Promise<ScratchGitOutcome> {
  const tree = Object.hasOwn(ledger.trees, name) ? ledger.trees[name] : undefined;
  if (tree === undefined) return refuse(`${name} is not a scratch tree of this agent family`);
  const present = await exists(tree.path);
  if (present && !await sameTree(deps.git, tree)) {
    return { text: `${tree.path} is no longer the tree scratch_git made, so it was left alone and forgotten.`, change: { retireTrees: [name] } };
  }
  // Check the branch before the worktree goes, while its reflog is still certain to be readable from the repository.
  const ownBranch = tree.branch !== undefined && await exists(tree.repo) && await sameBranch(deps.git, tree.repo, tree.branch);
  const scratch = await inScratch(deps, tree.path);
  if (present) {
    if (!scratch) {
      try { await backUpWorktree(tree.path, deps.backup); }
      catch (error) { refuse(`Backup of ${tree.path} failed, so it was not removed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (tree.kind === "worktree") await deps.git(tree.repo, ["worktree", "remove", "--force", "--", tree.path]);
    else if (scratch) await rm(tree.path, { recursive: true, force: true });
    else refuse(`${tree.path} is outside the scratch folder; scratch_git removes only clones it made there`);
  }
  // A tree deleted outside Git leaves its record in the repository, which keeps its branch checked out.
  if (!present && tree.kind === "worktree" && await exists(tree.repo)) await deps.git(tree.repo, ["worktree", "prune"]);
  const lines = [present ? `Removed ${tree.path}.` : `${tree.path} was already gone.`];
  if (tree.branch !== undefined) {
    const short = tree.branch.ref.slice("refs/heads/".length);
    if (ownBranch) { await deps.git(tree.repo, ["branch", "-D", "--", short]); lines.push(`Deleted branch ${short}.`); }
    else lines.push(`Kept branch ${short}: it is not certain that it is still the branch scratch_git made.`);
  }
  if (present && !scratch) lines.push(`A backup is in ${deps.backup.directory}.`);
  return { text: lines.join(" "), change: { retireTrees: [name] } };
}

/** The scratch branches named here, in the repository at `cwd`, that still have their creation identity. */
export async function ownsBranches(git: ScratchGitDeps["git"], ledger: ScratchLedger, cwd: string, names: readonly string[]): Promise<boolean> {
  if (names.length === 0) return false;
  const common = await realpath(gitLine(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  for (const name of names) {
    // A stale record of an earlier branch with this name may remain; any record whose identity matches proves ownership.
    const candidates = Object.values(ledger.trees).filter(item => item.common === common && item.branch?.ref === `refs/heads/${name}`);
    let owned = false;
    for (const tree of candidates) if (await sameBranch(git, cwd, tree.branch)) { owned = true; break; }
    if (!owned) return false;
  }
  return true;
}

interface RemoteView { url: string; endpoint: string; head: string; refs: Map<string, string> }
/** The one push URL of a remote, refusing rewritten or multiple endpoints, and what the remote holds now. */
async function remoteView(git: ScratchGitDeps["git"], cwd: string, remote: string): Promise<RemoteView> {
  if (remote === "" || remote.startsWith("-")) refuse(`remote must be a remote name; got ${remote}`);
  const keys = await git(cwd, ["config", "--list", "--name-only"]);
  if (keys.split("\n").some(key => /^url\..*\.(?:pushinsteadof|insteadof)$/iu.test(key))) refuse("A URL rewrite (insteadOf) is configured, so the push endpoint is uncertain");
  const urls = gitLine(await git(cwd, ["remote", "get-url", "--push", "--all", remote])).split("\n");
  if (urls.length !== 1 || urls[0] === undefined || urls[0] === "") refuse(`${remote} must have exactly one push URL`);
  const url = urls[0] ?? "";
  return readRemote(git, cwd, url, await canonicalGitEndpoint(url, cwd).catch(() => refuse(`Cannot identify the endpoint ${url}`)));
}
async function readRemote(git: ScratchGitDeps["git"], cwd: string, url: string, endpoint: string): Promise<RemoteView> {
  const lines = gitLine(await git(cwd, ["ls-remote", "--symref", url])).split("\n");
  const head = remoteHeadRef(lines.join("\n"));
  if (head === undefined) refuse(`Cannot read the default branch of ${url}`);
  const refs = new Map<string, string>();
  for (const line of lines) {
    const [sha, ref] = line.split("\t");
    if (sha !== undefined && ref !== undefined && /^[0-9a-f]{40,64}$/u.test(sha) && ref.startsWith("refs/")) refs.set(ref, sha);
  }
  return { url, endpoint, head: head ?? "", refs };
}

export interface PushArgs { name: string; ref: string; remoteRef: string; remote?: string }
export async function pushNewRef(deps: ScratchGitDeps, ledger: ScratchLedger, args: PushArgs, conversation: number): Promise<ScratchGitOutcome> {
  const tree = Object.hasOwn(ledger.trees, args.name) ? ledger.trees[args.name] : undefined;
  if (tree === undefined || !await sameTree(deps.git, tree)) return refuse(`${args.name} is not a scratch tree of this agent family`);
  checkRevision(args.ref, "ref");
  if (!/^refs\/(?:heads|tags)\/[^\s:^~?*[\\]+$/u.test(args.remoteRef)) refuse(`remoteRef must be a full refs/heads/... or refs/tags/... name; got ${args.remoteRef}`);
  await deps.git(tree.path, ["check-ref-format", args.remoteRef]).catch(() => refuse(`${args.remoteRef} is not a valid ref name`));
  const view = await remoteView(deps.git, tree.path, args.remote ?? "origin");
  if (args.remoteRef === view.head) refuse(`${args.remoteRef} is the default branch of ${view.url}; scratch_git never pushes there`);
  if (view.refs.has(args.remoteRef)) refuse(`${args.remoteRef} already exists on ${view.url}; scratch_git pushes only new refs`);
  const sha = gitLine(await deps.git(tree.path, ["rev-parse", "--verify", "--end-of-options", args.ref]));
  await deps.git(tree.path, ["push", "--quiet", view.url, `${sha}:${args.remoteRef}`]);
  const after = await readRemote(deps.git, tree.path, view.url, view.endpoint);
  if (after.refs.get(args.remoteRef) !== sha) return { text: `Pushed ${args.ref} to ${args.remoteRef}, but the remote no longer shows ${sha}, so it is not recorded as yours.`, change: {} };
  return { text: `Pushed ${args.ref} (${sha}) to ${args.remoteRef} on ${view.url}.`,
    change: { addRemote: { endpoint: view.endpoint, url: view.url, repo: tree.repo, ref: args.remoteRef, sha, conversation, at: deps.now() } } };
}

export interface DeleteRemoteArgs { remoteRef: string; url?: string }
export async function deleteRemoteRef(deps: ScratchGitDeps, ledger: ScratchLedger, args: DeleteRemoteArgs, cwd: string): Promise<ScratchGitOutcome> {
  const endpoint = args.url === undefined ? undefined : await canonicalGitEndpoint(args.url, cwd).catch(() => refuse(`Cannot identify the endpoint ${args.url ?? ""}`));
  const matches = ledger.remotes.filter(remote => remote.ref === args.remoteRef && (endpoint === undefined || remote.endpoint === endpoint));
  const [record, ...others] = matches;
  if (record === undefined) return refuse(`${args.remoteRef} was not pushed by scratch_git for this agent family`);
  if (others.length > 0) return refuse(`${args.remoteRef} was pushed to ${String(matches.length)} remotes; pass url to pick one`);
  // A scratch clone may be gone by cleanup time. The push goes to the recorded URL, so any repository can run it.
  const from = await exists(record.repo) ? record.repo : cwd;
  const view = await readRemote(deps.git, from, record.url, record.endpoint);
  if (record.ref === view.head) return refuse(`${record.ref} is now the default branch of ${record.url}; it was left alone`);
  const current = view.refs.get(record.ref);
  if (current === undefined) return { text: `${record.ref} is already gone from ${record.url}.`, change: { retireRemotes: [record] } };
  if (current !== record.sha) return { text: `${record.ref} on ${record.url} moved to ${current} after scratch_git pushed ${record.sha}, so it was left alone and forgotten.`, change: { retireRemotes: [record] } };
  // The lease makes Git itself refuse the delete if the ref moved after the read above.
  await deps.git(from, ["push", "--quiet", `--force-with-lease=${record.ref}:${record.sha}`, record.url, `:${record.ref}`]);
  return { text: `Deleted ${record.ref} from ${record.url}.`, change: { retireRemotes: [record] } };
}

export function listLedger(ledger: ScratchLedger): string {
  const trees = Object.values(ledger.trees).map(tree => `- ${tree.name}: ${tree.kind} at ${tree.path}${tree.branch === undefined ? "" : `, branch ${tree.branch.ref.slice("refs/heads/".length)}`}`);
  const remotes = ledger.remotes.map(remote => `- ${remote.ref} on ${remote.url} at ${remote.sha}`);
  return [trees.length === 0 ? "No scratch trees." : `Scratch trees:\n${trees.join("\n")}`, ...(remotes.length === 0 ? [] : [`Pushed refs:\n${remotes.join("\n")}`])].join("\n\n");
}
