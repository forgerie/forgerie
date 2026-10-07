import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleSlashIcon, GitBranchIcon, LoaderIcon, PlusIcon } from "lucide-react";
import type { WorktreeLifecycleState, WorktreeSetup } from "../worktrees/worktreeApi";
import { logTail, receiptText, setupSteps, type StepState } from "../worktrees/worktreeModel";

const STEP_ICON: Record<StepState, ReactNode> = {
  waiting: <CircleDashedIcon aria-hidden size={14} />,
  running: <LoaderIcon aria-hidden size={14} />,
  done: <CircleCheckIcon aria-hidden size={14} />,
  failed: <CircleAlertIcon aria-hidden size={14} />,
};
const STEP_WORD: Record<StepState, string> = { waiting: "waiting", running: "running", done: "done", failed: "failed" };

/**
 * System molecule: a fresh worktree being set up, at the head of what the
 * session will become. Steps, then the hook's output: its last lines while it
 * runs, the whole saved log once it failed. A clean setup is not drawn once the
 * first turn is live (`visibleSetup`); a failed one stays with its exit code.
 */
export function WorktreeSetupCard({ setup, hookSeen, branch, actions }: {
  setup: WorktreeSetup; hookSeen: boolean; branch?: string | undefined;
  /** What the reader can do about a failed setup. */
  actions?: ReactNode;
}) {
  const failed = setup.phase === "failed";
  const steps = setupSteps(setup, hookSeen);
  // Each new phase comes into view, so a short window never hides the setup below its fold.
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.scrollIntoView?.({ block: "nearest" }); }, [setup.phase]);
  // A failure's cause is at the end of its log.
  const log = useRef<HTMLPreElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [failed, setup.log]);
  const title = failed ? "Worktree setup failed" : setup.phase === "done" ? "Worktree ready" : "Preparing worktree";
  return <section ref={card} className="wt-setup" data-phase={setup.phase} aria-label={title} aria-busy={!failed && setup.phase !== "done"}>
    <header className="wt-setup-head">
      <span className="wt-setup-title" role={failed ? "alert" : "status"}>{title}</span>
      {branch && <span className="wt-branch"><GitBranchIcon aria-hidden size={14} />{branch}</span>}
    </header>
    <ol className="wt-steps">
      {steps.map((step) => <li key={step.key} data-state={step.state}>
        {STEP_ICON[step.state]}<span>{step.label}</span><span className="sr-only">, {STEP_WORD[step.state]}</span>
        {step.state === "failed" && setup.exitCode !== undefined && <code className="wt-exit">exit {setup.exitCode}</code>}
      </li>)}
    </ol>
    {/* The exit code already sits on its step; another reason gets its own line. */}
    {failed && setup.error && setup.exitCode === undefined && <p className="wt-error">{setup.error}</p>}
    {/* What to do comes before the log, so a long log never pushes it out of reach. */}
    {actions && <div className="wt-setup-actions">{actions}</div>}
    {setup.log !== "" && (failed
      ? <details className="wt-log" open><summary>Log</summary><pre ref={log} tabIndex={0}>{setup.log}</pre></details>
      : setup.phase === "hook" && <pre className="wt-log-tail" aria-live="off"><span>{logTail(setup.log)}</span></pre>)}
  </section>;
}

/**
 * System molecule: where the input bar was, for a conversation whose worktree
 * is gone. It says what happened and offers a new session; it never offers a
 * box to type into, because Pi cannot run in a folder that no longer exists.
 */
export function WorktreeReceipt({ state, defaultBranch, branch, onNew }: {
  /** Absent when the server marked the session read-only before its worktree was read. */
  state?: WorktreeLifecycleState | undefined; defaultBranch?: string | undefined; branch?: string | undefined; onNew?: (() => void) | undefined;
}) {
  const text = (state && receiptText(state, defaultBranch ?? "main")) ?? "This worktree is gone";
  return <div className="wt-receipt" data-state={state?.kind} role="status">
    <span className="wt-receipt-mark" aria-hidden>{state?.kind === "landed" ? <CircleCheckIcon size={16} /> : <CircleSlashIcon size={16} />}</span>
    <p className="wt-receipt-text"><strong>{text}</strong>
      <span>{branch ? `Its worktree, ${branch}, is gone.` : "Its worktree is gone."} This conversation is read-only.</span></p>
    {onNew && <button type="button" className="wt-secondary" onClick={onNew}><PlusIcon aria-hidden size={16} />New session</button>}
  </div>;
}
