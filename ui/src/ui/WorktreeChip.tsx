import { CircleCheckIcon, CircleSlashIcon, GitBranchIcon } from "lucide-react";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import { readouts, receiptText, shortSha } from "../worktrees/worktreeModel";

/**
 * System atom: a worktree's counts as short marks, "↑4 ±2". Readouts only:
 * they truncate before any control does, and the sentence they stand for is
 * the title and the accessible name.
 */
export function WorktreeMarks({ info }: { info: WorktreeInfo }) {
  const { marks, sentence } = readouts(info);
  if (marks.length === 0) return null;
  return <span className="worktree-marks" title={sentence} aria-label={sentence}>
    {marks.map((mark) => <span key={mark.key} data-mark={mark.key} aria-hidden>{mark.text}</span>)}
  </span>;
}

/**
 * System molecule: the session's branch on the input bar. The branch name
 * gives way first (it ellipsizes), then the marks; neither is a control, so
 * the bar's buttons keep their room at every width. The session menu repeats
 * the whole sentence.
 */
export function WorktreeChip({ info }: { info: WorktreeInfo }) {
  const { sentence } = readouts(info);
  return <span className="worktree-chip" title={`${info.branch} · ${sentence}`}>
    <GitBranchIcon aria-hidden size={14} />
    <span className="worktree-chip-branch"><span className="sr-only">Branch </span>{info.branch}</span>
    <WorktreeMarks info={info} />
  </span>;
}

/** A picker row's worktree word: the counts while active, the outcome after. */
export function WorktreeRowMark({ info }: { info: WorktreeInfo }) {
  if (info.state.kind === "landed") {
    return <span className="worktree-row-state" data-state="landed" title={receiptText(info.state, info.defaultBranch)}>
      <CircleCheckIcon aria-hidden />landed {shortSha(info.state.sha)}</span>;
  }
  if (info.state.kind === "discarded") {
    return <span className="worktree-row-state" data-state="discarded" title="Worktree discarded"><CircleSlashIcon aria-hidden />discarded</span>;
  }
  return <WorktreeMarks info={info} />;
}
