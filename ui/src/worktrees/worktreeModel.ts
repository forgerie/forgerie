// Pure worktree presentation rules: what a setup shows, how counts read, and
// what a Land or Discard result means to the reader. No I/O.
import type { DiscardPreview, WorktreeActionResult, WorktreeInfo, WorktreeLifecycleState, WorktreeOptions, WorktreeSetup } from "./worktreeApi";

export type StepState = "waiting" | "running" | "done" | "failed";
export interface SetupStep { key: "create" | "hook" | "start"; label: string; state: StepState }
export const POST_CREATE_HOOK = "worktree-post-create";

/**
 * The steps of a worktree setup, in order. The hook step shows only once the
 * server reports it ran, because only the server knows whether the repository
 * has one; a setup without a hook never shows a step it will not take.
 */
export function setupSteps(setup: WorktreeSetup, hookSeen: boolean): SetupStep[] {
  const order = ["creating", "hook", "starting", "done"] as const;
  const failedAt = setup.phase === "failed" ? failedStep(setup, hookSeen) : undefined;
  const reached = setup.phase === "failed" ? undefined : order.indexOf(setup.phase);
  const state = (index: number, key: SetupStep["key"]): StepState => {
    if (failedAt) return key === failedAt ? "failed" : stepIndex(key) < stepIndex(failedAt) ? "done" : "waiting";
    if (reached === undefined) return "waiting";
    return index < reached ? "done" : index === reached ? "running" : "waiting";
  };
  const steps: SetupStep[] = [{ key: "create", label: "Create worktree", state: state(0, "create") }];
  if (hookSeen || setup.phase === "hook") steps.push({ key: "hook", label: `Run ${POST_CREATE_HOOK}`, state: state(1, "hook") });
  steps.push({ key: "start", label: "Start Pi", state: state(2, "start") });
  return steps;
}
const stepIndex = (key: SetupStep["key"]) => ["create", "hook", "start"].indexOf(key);
function failedStep(setup: WorktreeSetup, hookSeen: boolean): SetupStep["key"] {
  if (setup.exitCode !== undefined || /hook/iu.test(setup.error ?? "")) return "hook";
  // A log means the hook ran; Pi failing to start after it is the last step.
  return hookSeen || setup.log !== "" ? "start" : "create";
}

/**
 * Whether a setup belongs on screen. A running setup always shows. A failed
 * one stays, so its exit code and log are reachable. A clean one shows only
 * for a confirmed empty conversation. Unloaded history is not an empty
 * conversation, even when the catalog already reports setup as complete.
 */
export function visibleSetup(setup: WorktreeSetup | undefined, conversation: "loading" | "empty" | "live"): WorktreeSetup | undefined {
  if (!setup) return undefined;
  if (setup.phase === "failed") return setup;
  if (setup.phase !== "done") return setup;
  return conversation === "empty" ? setup : undefined;
}

/** The last lines of a log, so a card never grows without bound. The full log is one press away. */
export function logTail(log: string, lines = 6): string {
  const all = log.replace(/\s+$/u, "").split("\n");
  return all.slice(-lines).join("\n");
}

/** What the new-session dialog sentence says for a destination. */
export function freshLabel(project: string, options: Extract<WorktreeOptions, { kind: "git" }>): string {
  return `${project} · new worktree from ${options.defaultBranch}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

export interface Readouts {
  /** Short marks for a chip or a row: "↑4", "±2". Empty while nothing is known. */
  marks: { key: "ahead" | "dirty" | "error"; text: string; label: string }[];
  /** One sentence for a menu header or a title. */
  sentence: string;
}
/** How an active worktree's counts read. An unreadable status says so; it never reads as clean. */
export function readouts(info: Pick<WorktreeInfo, "ahead" | "dirtyFiles" | "statusError" | "defaultBranch" | "behind">): Readouts {
  if (info.statusError !== undefined) {
    return { marks: [{ key: "error", text: "?", label: `Git status unavailable: ${info.statusError}` }], sentence: `Git status unavailable: ${info.statusError}` };
  }
  const marks: Readouts["marks"] = [];
  const parts: string[] = [];
  if (info.ahead !== undefined) {
    if (info.ahead > 0) marks.push({ key: "ahead", text: `↑${String(info.ahead)}`, label: `${plural(info.ahead, "commit")} not on ${info.defaultBranch}` });
    parts.push(info.ahead === 0 ? `No commits ahead of ${info.defaultBranch}` : `${plural(info.ahead, "commit")} ahead of ${info.defaultBranch}`);
  }
  if (info.behind !== undefined && info.behind > 0) parts.push(`${String(info.behind)} behind`);
  if (info.dirtyFiles !== undefined) {
    if (info.dirtyFiles > 0) marks.push({ key: "dirty", text: `±${String(info.dirtyFiles)}`, label: `${plural(info.dirtyFiles, "changed file")} not committed` });
    parts.push(info.dirtyFiles === 0 ? "clean" : `${plural(info.dirtyFiles, "changed file")}`);
  }
  return { marks, sentence: parts.length ? parts.join(", ") : "Counting changes…" };
}

/** The short sha a person reads. */
export const shortSha = (sha: string) => sha.slice(0, 7);

/** A completed worktree's receipt line. */
export function receiptText(state: WorktreeLifecycleState, defaultBranch: string): string | undefined {
  if (state.kind === "landed") return `Landed on ${defaultBranch} at ${shortSha(state.sha)}`;
  if (state.kind === "discarded") return "Worktree discarded";
  return undefined;
}

/** Land's blocked reasons in plain words. An unknown reason shows as the server wrote it. */
export function blockedText(reason: string, defaultBranch: string): string {
  switch (reason) {
    case "related-worktrees-active": return "This chat still owns related worktrees. Land or discard those first from the session menu (⋯).";
    case "worktree-dirty": return "This worktree has uncommitted changes. Ask the agent to commit or drop them, then land again.";
    case "main-dirty": return `The main checkout has uncommitted changes in files this land would touch. Commit or stash them on ${defaultBranch}, then land again.`;
    case "main-not-on-default-branch": return `The main checkout is not on ${defaultBranch}. Switch it back to ${defaultBranch}, then land again.`;
    default: return reason;
  }
}

/** What Discard will throw away, as the confirm step says it. */
export function discardSummary(preview: Pick<DiscardPreview, "commits" | "dirtyFiles" | "defaultBranch">): string {
  const lost: string[] = [];
  if (preview.commits.length) lost.push(`${plural(preview.commits.length, "commit")} not on ${preview.defaultBranch}`);
  if (preview.dirtyFiles.length) lost.push(plural(preview.dirtyFiles.length, "uncommitted file"));
  if (lost.length === 0) return `Nothing here is missing from ${preview.defaultBranch}. Discard removes the worktree and its ignored files, such as dependencies and builds.`;
  return `${lost.join(" and ")} will be lost. Discard also removes ignored files, such as dependencies and builds.`;
}

/** What an archive left behind: a short title that always shows, and the reason, shown on request. */
export interface ArchiveNote { title: string; text: string }

/**
 * Why archiving kept a worktree. The toast shows only the first words until
 * the reader opens it, so each sentence starts with the cause and names the
 * branch after it. The server sends a code; an unknown one shows as sent.
 */
export function retainedText(reason: string, branch: string, defaultBranch: string): string | undefined {
  switch (reason) {
    case "unlanded-commits": return `It has commits that are not on ${defaultBranch}. Land or discard ${branch} to remove it.`;
    case "dirty": return `It has uncommitted changes. Land or discard ${branch} to remove it.`;
    case "shared": return `Another session still works in ${branch}.`;
    case "checkout-changed": return `Its folder or branch changed outside Forgerie. Remove ${branch} yourself if you no longer need it.`;
    case "related-worktrees-active": return `The chat still owns related worktrees. Finish those from the session menu (⋯), then archive again.`;
    // Landed or discarded already: nothing is left to remove, so there is nothing to say.
    case "already-completed": return undefined;
    default: return `${reason} (${branch})`;
  }
}

/**
 * What archiving left behind. The server removes a clean, landed, unshared
 * worktree by itself and says nothing; a worktree it kept, or failed to
 * remove, gets the server's own reason.
 */
export function archiveNote(info: Pick<WorktreeInfo, "archiveCleanup" | "branch" | "defaultBranch">): ArchiveNote | undefined {
  const cleanup = info.archiveCleanup;
  if (cleanup?.kind === "retained") {
    const text = retainedText(cleanup.reason, info.branch, info.defaultBranch);
    return text ? { title: "Worktree kept", text } : undefined;
  }
  if (cleanup?.kind === "removed" && cleanup.cleanup.kind === "failed") return { title: "Worktree not removed", text: `${cleanup.cleanup.error} (${info.branch})` };
  return undefined;
}

export type ActionOutcome =
  | { tone: "done"; title: string; detail?: string | undefined }
  | { tone: "conflict"; title: string; files: string[]; prompt: string }
  | { tone: "blocked"; title: string; detail: string; files: string[] }
  | { tone: "stale"; title: string };

/** How a Land or Discard result reads. A cleanup that failed after a land is still a land. */
export function outcomeOf(result: WorktreeActionResult, defaultBranch: string): ActionOutcome {
  switch (result.kind) {
    case "landed": return { tone: "done", title: `Landed on ${defaultBranch} at ${shortSha(result.sha)}`, detail: cleanupText(result.cleanup) };
    case "discarded": return { tone: "done", title: "Worktree discarded", detail: cleanupText(result.cleanup) };
    case "conflict": return { tone: "conflict", title: `Rebase onto ${result.defaultBranch} stopped on ${plural(result.files.length, "conflict")}. Nothing changed.`, files: result.files, prompt: result.prompt };
    case "blocked": return { tone: "blocked", title: "Land did not start", detail: blockedText(result.reason, defaultBranch), files: result.files };
    case "stale-preview": return { tone: "stale", title: "The worktree changed since this list. Review it again before you discard." };
  }
}
function cleanupText(cleanup: WorktreeInfo["cleanup"]): string | undefined {
  if (cleanup.kind === "failed") return `The worktree folder was not removed: ${cleanup.error} Run the same action again to retry the cleanup.`;
  if (cleanup.kind === "pending") return "Removing the worktree folder…";
  return undefined;
}
