import { createElement } from "react";
import { FileDiffIcon, GitMergeIcon, GitPullRequestIcon, MessageSquareTextIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import type { SessionMenuSection } from "../ui/WorktreeActions";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import { readouts } from "../worktrees/worktreeModel";

export type RelatedAction = "changes" | "pulls" | "land" | "discard" | "retry" | "explain" | "notes";

const icon = (type: typeof FileDiffIcon) => createElement(type, { "aria-hidden": true });
export const repoName = (info: WorktreeInfo) => info.repo.split("/").filter(Boolean).at(-1) ?? info.repo;

/** A related worktree has a section while it holds work or needs cleanup. A finished one leaves. */
export const listed = (info: WorktreeInfo) => info.state.kind === "active" || info.cleanup.kind !== "done";

function status(info: WorktreeInfo, failure: string | undefined): { sentence: string; tone?: "danger" } {
  if (failure) return { sentence: failure, tone: "danger" };
  if (info.cleanup.kind === "failed") return { sentence: `Cleanup failed: ${info.cleanup.error}`, tone: "danger" };
  if (info.state.kind === "landed") return { sentence: `Landed on ${info.defaultBranch}. Cleanup is not done.` };
  if (info.state.kind === "discarded") return { sentence: "Discarded. Cleanup is not done." };
  if (info.setup.phase === "failed") return { sentence: `Setup failed${info.setup.error ? `: ${info.setup.error}` : ""}`, tone: "danger" };
  if (info.setup.phase !== "done") return { sentence: "Setting up…" };
  return { sentence: readouts(info).sentence };
}

/**
 * The session menu's sections for the worktrees this chat made in other
 * repos: each repo's review, pull requests, Land and Discard, or the way
 * to recover when setup or cleanup failed.
 */
export function relatedSections(worktrees: readonly WorktreeInfo[], options: {
  busy: boolean;
  /** Review notes waiting, per worktree id. */
  notes: Readonly<Record<string, number>>;
  /** A refused command's reason, per worktree id. */
  failures: Readonly<Record<string, string>>;
  onAction: (action: RelatedAction, info: WorktreeInfo) => void;
}): SessionMenuSection[] {
  const { busy, notes, failures, onAction } = options;
  const stop = busy ? "Stop the run first" : undefined;
  return worktrees.filter(listed).map((info) => {
    const act = (action: RelatedAction) => () => onAction(action, info);
    const commands: SessionMenuSection["commands"][number][] = [];
    const ready = info.state.kind === "active" && info.setup.phase === "done";
    const waiting = notes[info.id] ?? 0;
    if (ready) {
      commands.push({ label: "Changes and files", icon: icon(FileDiffIcon), onSelect: act("changes") },
        { label: "Pull requests", icon: icon(GitPullRequestIcon), onSelect: act("pulls") });
      if (waiting > 0) commands.push({ label: `Add ${String(waiting)} review ${waiting === 1 ? "note" : "notes"} to the message`, icon: icon(MessageSquareTextIcon), onSelect: act("notes") });
      commands.push({ label: `Land on ${info.defaultBranch}…`, icon: icon(GitMergeIcon), disabled: busy, hint: stop, onSelect: act("land") });
    }
    if (info.state.kind === "active" && info.setup.phase === "failed") {
      commands.push({ label: "Retry setup", icon: icon(RotateCwIcon), disabled: busy, hint: stop, onSelect: act("retry") },
        { label: "Ask the agent about the failure", icon: icon(MessageSquareTextIcon), onSelect: act("explain") });
    }
    if (info.state.kind === "landed") commands.push({ label: "Retry cleanup", icon: icon(RotateCwIcon), disabled: busy, hint: stop, onSelect: act("land") });
    else if (info.state.kind === "discarded") commands.push({ label: "Retry cleanup", icon: icon(RotateCwIcon), disabled: busy, hint: stop, onSelect: act("discard") });
    else if (info.setup.phase === "done" || info.setup.phase === "failed") {
      commands.push({ label: "Discard worktree…", icon: icon(Trash2Icon), tone: "danger", disabled: busy, hint: stop, onSelect: act("discard") });
    }
    return { key: info.id, title: repoName(info), ...status(info, failures[info.id]), commands };
  });
}
