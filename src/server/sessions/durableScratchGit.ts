import { randomBytes } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineExtension, defineTool, type ConversationId, type Harness, type ToolExecutionApi, type Tx } from "@earendil-works/pi-durable";
import {
  applyScratchChange, cloneRepository, createWorktree, deleteRemoteRef, listLedger, ownsBranches, pushNewRef, removeTree,
  ScratchGitRefusal, type ScratchGitDeps, type ScratchGitOutcome, type ScratchLedger,
} from "./scratchGit.js";

export const SCRATCH_GIT_DOC_KIND = "forgerie.scratch-git";
/** One ledger per agent family, on the parent conversation. Children write here, never to their own copy. */
export const ScratchGitLedger = defineDoc<ScratchLedger>({
  kind: SCRATCH_GIT_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ trees: {}, remotes: [] }),
});
export const SCRATCH_GIT_TOOL = "scratch_git";

/** The family's parent: follow creator edges until a conversation that no task created. */
export async function familyParent(tx: Tx, id: ConversationId): Promise<ConversationId> {
  const seen = new Set<ConversationId>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const record = await tx.conversation(current);
    if (record === undefined) throw new Error(`Missing conversation ${String(current)}`);
    if (record.owner === undefined) return current;
    current = record.owner.conversationId;
  }
  throw new Error("Cyclic conversation ownership");
}

const params = Type.Object({
  action: Type.Union([Type.Literal("create_worktree"), Type.Literal("clone"), Type.Literal("remove"), Type.Literal("list"), Type.Literal("push"), Type.Literal("delete_remote")]),
  name: Type.Optional(Type.String({ description: "The scratch tree's short name: letters, digits, dot, dash, underscore." })),
  repo: Type.Optional(Type.String({ description: "create_worktree: the repository to branch from. Default: your working directory." })),
  ref: Type.Optional(Type.String({ description: "create_worktree and clone: the commit to check out. push: the local commit or tag to push." })),
  branch: Type.Optional(Type.String({ description: "create_worktree: make this new branch. Without it the worktree is detached." })),
  place: Type.Optional(Type.Union([Type.Literal("scratch"), Type.Literal("project")], { description: "create_worktree: scratch (default, under /tmp) or project (the repository's .worktree folder)." })),
  source: Type.Optional(Type.String({ description: "clone: a repository path or URL." })),
  shared: Type.Optional(Type.Boolean({ description: "clone: share objects with a local source (git clone --shared)." })),
  remote: Type.Optional(Type.String({ description: "push: the remote name. Default: origin." })),
  remoteRef: Type.Optional(Type.String({ description: "push and delete_remote: a full refs/heads/... or refs/tags/... name." })),
  url: Type.Optional(Type.String({ description: "delete_remote: the remote URL, when the same ref was pushed to more than one remote." })),
}, { additionalProperties: false });

const DESCRIPTION = "Make and clean up throwaway Git work that you own, without approval. create_worktree (repo, name, ref?, branch?, place?) and clone (source, name, ref?, shared?) return a path; work there with bash. remove (name) deletes the tree and the branch it made, even with uncommitted changes, with a backup outside /tmp. push (name, ref, remoteRef) creates a new remote branch or tag, never a default branch; delete_remote (remoteRef) deletes one it pushed, while the remote still holds that commit. list shows what you own. In bash, git branch -D of a branch scratch_git made is also not gated.";

const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], ...(isError ? { isError: true } : {}) });

/** The `scratch_git` tool for parents and children. `deps` are daemon-wide; the family comes from the calling conversation. */
export function scratchGitTool(deps: ScratchGitDeps) {
  return defineTool({
    name: SCRATCH_GIT_TOOL, description: DESCRIPTION, parameters: params, executionMode: "sequential",
    execute: async (args, api, context) => {
      if (api.env === undefined) return text("No working directory is configured.", true);
      const env = api.env;
      const folder = async (path: string | undefined) => {
        const resolved = await env.absolutePath(path ?? ".", context);
        if (!resolved.ok) throw new ScratchGitRefusal(`Cannot use ${path ?? "."}: ${resolved.error.message}`);
        return resolved.value;
      };
      const need = (value: string | undefined, label: string) => {
        if (value === undefined || value === "") throw new ScratchGitRefusal(`${args.action} needs ${label}`);
        return value;
      };
      try {
        const parent = await api.commit(tx => familyParent(tx, api.conversationId), context);
        const ledger = await readLedger(api, parent, context);
        if (args.action === "list") return text(listLedger(ledger));
        const cwd = await folder(undefined);
        let outcome: ScratchGitOutcome;
        switch (args.action) {
          case "create_worktree":
            outcome = await createWorktree(deps, ledger, await familyRoot(api, parent, context), { repo: await folder(args.repo), name: need(args.name, "name"),
              ...(args.ref === undefined ? {} : { ref: args.ref }), ...(args.branch === undefined ? {} : { branch: args.branch }), ...(args.place === undefined ? {} : { place: args.place }) }, api.conversationId);
            break;
          case "clone":
            outcome = await cloneRepository(deps, ledger, await familyRoot(api, parent, context), { source: need(args.source, "source"), name: need(args.name, "name"),
              ...(args.ref === undefined ? {} : { ref: args.ref }), ...(args.shared === undefined ? {} : { shared: args.shared }) }, cwd, api.conversationId);
            break;
          case "remove":
            outcome = await removeTree(deps, ledger, need(args.name, "name"));
            break;
          case "push":
            outcome = await pushNewRef(deps, ledger, { name: need(args.name, "name"), ref: need(args.ref, "ref"), remoteRef: need(args.remoteRef, "remoteRef"),
              ...(args.remote === undefined ? {} : { remote: args.remote }) }, api.conversationId);
            break;
          case "delete_remote":
            outcome = await deleteRemoteRef(deps, ledger, { remoteRef: need(args.remoteRef, "remoteRef"), ...(args.url === undefined ? {} : { url: args.url }) }, cwd);
            break;
        }
        // The Git effect already happened. A crash before this commit leaves the work unowned, which only gates more.
        await api.commit(async tx => { applyScratchChange(await tx.doc(ScratchGitLedger, parent), outcome.change); }, context);
        return text(outcome.text);
      } catch (error) {
        if (error instanceof ScratchGitRefusal) return text(error.message, true);
        const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
        return text(`scratch_git ${args.action} failed: ${stderr || (error instanceof Error ? error.message : String(error))}`, true);
      }
    },
  });
}

async function readLedger(api: Pick<ToolExecutionApi, "snapshot">, parent: ConversationId, context: Context): Promise<ScratchLedger> {
  return structuredClone(await api.snapshot(ScratchGitLedger, parent, context) ?? { trees: {}, remotes: [] });
}
/** The family's folder name under the scratch root, chosen once. Random, so two journals never share a folder. */
async function familyRoot(api: Pick<ToolExecutionApi, "commit">, parent: ConversationId, context: Context): Promise<string> {
  const candidate = `f-${randomBytes(4).toString("hex")}`;
  return api.commit(async tx => { const ledger = await tx.doc(ScratchGitLedger, parent); ledger.root ??= candidate; return ledger.root; }, context);
}

export function scratchGitExtension(tool: ReturnType<typeof scratchGitTool>) {
  return defineExtension({ name: "forgerie.scratch-git", tools: [tool] });
}

/** The gate's read: whether the family's `scratch_git` made these branches. Reads the parent's ledger, then Git. */
export function scratchBranchReader(harness: () => Harness, parent: ConversationId, git: ScratchGitDeps["git"], context: Context) {
  return async (cwd: string, names: readonly string[]): Promise<boolean> => {
    const ledger = await harness().snapshot(ScratchGitLedger, parent, context);
    return ledger !== undefined && ownsBranches(git, ledger, cwd, names);
  };
}
