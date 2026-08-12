export interface ComposerIdentityWorkspace {
  readonly label: string;
  readonly branch?: string;
  readonly isMain?: boolean;
}

export interface ComposerBranchIdentity {
  /** What the rail shows: short enough to sit beside the model name. */
  readonly name: string;
  /** The whole ref, so nothing is lost to shortening. */
  readonly title: string;
}

/**
 * Prefixes that group work rather than name it.
 *
 * Measured across every worktree on this machine, `feat` alone covers nearly
 * half, so the prefix costs characters without telling the branches apart.
 */
const CATEGORY_PREFIXES = new Set(["feat", "fix", "refactor", "spike", "work", "docs", "chore", "ci", "test", "build", "perf", "style"]);

/**
 * What the composer states about place.
 *
 * Nothing on a project's main worktree: that is where sessions are expected to
 * run, so naming it spends the row's width on the least surprising fact
 * available. Anywhere else, the branch is named without its category prefix.
 */
export function composerBranchIdentity(workspace: ComposerIdentityWorkspace | undefined): ComposerBranchIdentity | undefined {
  if (workspace === undefined || workspace.isMain === true) return undefined;
  const ref = workspace.branch !== undefined && workspace.branch !== "" ? workspace.branch : workspace.label;
  if (ref === "") return undefined;
  const slash = ref.indexOf("/");
  const prefix = slash <= 0 ? undefined : ref.slice(0, slash);
  const name = prefix !== undefined && CATEGORY_PREFIXES.has(prefix) ? ref.slice(slash + 1) : ref;
  return { name, title: ref };
}
