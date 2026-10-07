import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlertIcon, CircleCheckIcon, EllipsisIcon, GitBranchIcon, GitMergeIcon, LoaderIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import type { DiscardPreview, WorktreeActionResult, WorktreeApi, WorktreeInfo } from "../worktrees/worktreeApi";
import { discardSummary, outcomeOf, readouts, shortSha, type ActionOutcome } from "../worktrees/worktreeModel";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
export type WorktreeCommand = "land" | "discard";

/** Why Land or Discard cannot run now, or undefined when it can. The server checks again. */
export function worktreeCommandBlock(info: WorktreeInfo, busy: boolean): string | undefined {
  if (!info.owned) return "Another session owns this worktree";
  if (info.state.kind !== "active") return info.state.kind === "landed" ? "Already landed" : "Already discarded";
  if (info.setup.phase !== "done") return info.setup.phase === "failed" ? "Setup failed" : "Still setting up";
  if (busy) return "Stop the run first";
  return undefined;
}

/**
 * System molecule: the session's overflow menu in the header. It holds the
 * commands too rare for the header row, and the readouts the input bar's
 * branch chip gives up when the bar is narrow.
 */
export function SessionMenu({ info, busy, onCommand }: { info: WorktreeInfo; busy: boolean; onCommand: (command: WorktreeCommand) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  const blocked = worktreeCommandBlock(info, busy);
  const run = (command: WorktreeCommand) => { setOpen(false); onCommand(command); };
  const { sentence } = readouts(info);
  return <div ref={root} className="session-menu-root" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }}>
    <button ref={button} type="button" className="icon-button quiet-button" aria-label="Session menu" title="Session menu"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
      <EllipsisIcon aria-hidden size={18} /></button>
    {open && <div id={menuId} className="picker-menu session-menu" role="menu" aria-label="Session menu">
      <div className="session-menu-head" role="presentation">
        <GitBranchIcon aria-hidden size={14} />
        <span className="session-menu-branch">{info.branch}</span>
        <span className="session-menu-sentence">{info.state.kind === "active" ? sentence : null}</span>
      </div>
      <div className="picker-menu-separator" role="separator" />
      <button type="button" role="menuitem" disabled={blocked !== undefined} onClick={() => run("land")}>
        <GitMergeIcon aria-hidden />Land on {info.defaultBranch}…{blocked ? <small>{blocked}</small> : null}</button>
      <button type="button" role="menuitem" data-tone="danger" disabled={blocked !== undefined} onClick={() => run("discard")}>
        <Trash2Icon aria-hidden />Discard worktree…{blocked ? <small>{blocked}</small> : null}</button>
    </div>}
  </div>;
}

type Step =
  | { type: "loading" }
  | { type: "confirm"; preview?: DiscardPreview | undefined; note?: string | undefined }
  | { type: "working"; preview?: DiscardPreview | undefined }
  | { type: "outcome"; outcome: ActionOutcome }
  | { type: "error"; message: string; preview?: DiscardPreview | undefined };

/**
 * System organism: Land or Discard, confirmed in a small modal. The server
 * does the work and says what happened; this view only asks first and reports.
 * A conflict is offered to the agent as a prompt; nothing here edits files.
 */
export function WorktreeDialog({ command, info, api, onAsk, onDone, onClose }: {
  command: WorktreeCommand; info: WorktreeInfo; api: Pick<WorktreeApi, "land" | "discardPreview" | "discard">;
  /** Send the server's conflict prompt to this session's agent. */
  onAsk?: ((prompt: string) => Promise<void>) | undefined;
  /** The worktree changed: read its status again. */
  onDone: (result: WorktreeActionResult) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [step, setStep] = useState<Step>(command === "discard" ? { type: "loading" } : { type: "confirm" });
  const [asking, setAsking] = useState<string>();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => { if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal(); }, [dialog]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  const busy = step.type === "working" || step.type === "loading" || asking === "sending";
  const preview = async (note?: string) => {
    setStep({ type: "loading" });
    try { setStep({ type: "confirm", preview: await api.discardPreview(info.id), note }); }
    catch (error) { setStep({ type: "error", message: messageOf(error) }); }
  };
  // Once per open: the dialog mounts for one command on one worktree.
  const opened = useRef(false);
  useEffect(() => { if (opened.current) return; opened.current = true; if (command === "discard") void preview(); });
  const act = async () => {
    const current = step.type === "confirm" || step.type === "error" ? step.preview : undefined;
    if (command === "discard" && !current) { void preview(); return; }
    setStep({ type: "working", preview: current });
    try {
      const result = command === "land" ? await api.land(info.id) : await api.discard(info.id, current!.confirmationToken);
      if (result.kind === "stale-preview") { void preview(outcomeOf(result, info.defaultBranch).title); return; }
      setStep({ type: "outcome", outcome: outcomeOf(result, info.defaultBranch) });
      onDone(result);
    } catch (error) { setStep({ type: "error", message: messageOf(error), preview: current }); }
  };
  const ask = async (prompt: string) => {
    if (!onAsk) return;
    setAsking("sending");
    try { await onAsk(prompt); onClose(); }
    catch (error) { setAsking(`The prompt did not send: ${messageOf(error)}`); }
  };
  const close = () => { if (!busy) onClose(); };
  const verb = command === "land" ? `Land on ${info.defaultBranch}` : "Discard worktree";
  const outcome = step.type === "outcome" ? step.outcome : undefined;
  const currentPreview = step.type === "confirm" || step.type === "working" || step.type === "error" ? step.preview : undefined;
  let body: ReactNode;
  let actions: ReactNode;
  if (outcome) {
    body = <Outcome outcome={outcome} />;
    actions = outcome.tone === "conflict" ? <>
      <button type="button" className="wt-secondary" disabled={asking === "sending"} onClick={onClose}>Close</button>
      {onAsk && <button type="button" className="primary wt-primary" disabled={asking === "sending"} onClick={() => void ask(outcome.prompt)}>
        <MessageSquareIcon aria-hidden size={16} />{asking === "sending" ? "Sending…" : "Ask the agent to resolve"}</button>}
    </> : <button type="button" className="primary wt-primary" onClick={onClose}>Done</button>;
  } else {
    body = <>
      {command === "land" ? <LandSummary info={info} /> : currentPreview ? <DiscardList preview={currentPreview} />
        : step.type === "loading" ? <p className="wt-status" role="status"><LoaderIcon aria-hidden size={14} />Reading what is not on {info.defaultBranch}…</p> : null}
      {step.type === "confirm" && step.note && <p className="wt-warning" role="alert">{step.note}</p>}
      {step.type === "error" && <p className="wt-error" role="alert">{step.message}</p>}
    </>;
    actions = <>
      <button type="button" className="wt-secondary" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="primary wt-primary" data-tone={command === "discard" ? "danger" : undefined}
        disabled={busy || (command === "discard" && !currentPreview && step.type !== "error")} onClick={() => void act()}>
        {step.type === "working" ? (command === "land" ? "Landing…" : "Discarding…") : step.type === "error" && command === "discard" && !currentPreview ? "Try again" : verb}</button>
    </>;
  }
  return createPortal(<dialog ref={setDialog} className="wt-dialog" aria-labelledby={titleId} aria-busy={busy || undefined}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="wt-card">
      <header className="wt-head">
        <span className="wt-mark" aria-hidden>{command === "land" ? <GitMergeIcon size={16} /> : <Trash2Icon size={16} />}</span>
        <h2 id={titleId}>{outcome ? (command === "land" ? "Land" : "Discard") : `${verb}?`}</h2>
        <span className="wt-branch" title={info.path}><GitBranchIcon aria-hidden size={14} />{info.branch}</span>
      </header>
      <div className="wt-body">{body}</div>
      {asking && asking !== "sending" && <p className="wt-error" role="alert">{asking}</p>}
      <footer className="wt-foot">{actions}</footer>
    </div>
  </dialog>, document.body);
}

function LandSummary({ info }: { info: WorktreeInfo }) {
  const ahead = info.ahead;
  return <>
    <p className="wt-lead">{ahead === undefined ? `Rebase ${info.branch} onto ${info.defaultBranch}, then fast-forward ${info.defaultBranch}.`
      : ahead === 0 ? `${info.branch} has no commits that ${info.defaultBranch} lacks. Landing removes the worktree.`
      : `${String(ahead)} ${ahead === 1 ? "commit lands" : "commits land"} on ${info.defaultBranch}: Forgerie rebases ${info.branch} onto ${info.defaultBranch}, then fast-forwards it. Nothing is pushed.`}</p>
    {info.dirtyFiles !== undefined && info.dirtyFiles > 0 && <p className="wt-warning">
      {info.dirtyFiles === 1 ? "1 file is" : `${String(info.dirtyFiles)} files are`} not committed. Land refuses uncommitted work: ask the agent to commit it first.</p>}
    <p className="wt-note">The worktree is removed afterward. This conversation stays readable, but it cannot continue.</p>
  </>;
}

function DiscardList({ preview }: { preview: DiscardPreview }) {
  return <>
    <p className="wt-lead" data-tone={preview.commits.length || preview.dirtyFiles.length ? "danger" : undefined}>{discardSummary(preview)}</p>
    {preview.commits.length > 0 && <ul className="wt-list" aria-label="Commits that will be lost">
      {preview.commits.map((commit) => <li key={commit.sha}><code>{shortSha(commit.sha)}</code><span>{commit.subject || "(no subject)"}</span></li>)}
    </ul>}
    {preview.dirtyFiles.length > 0 && <ul className="wt-list" aria-label="Uncommitted files that will be lost">
      {preview.dirtyFiles.map((file) => <li key={file}><span className="wt-path">{file}</span></li>)}
    </ul>}
    <p className="wt-note">This conversation stays readable, but it cannot continue.</p>
  </>;
}

function Outcome({ outcome }: { outcome: ActionOutcome }) {
  const icon = outcome.tone === "done" ? <CircleCheckIcon aria-hidden size={18} /> : <CircleAlertIcon aria-hidden size={18} />;
  return <div className="wt-outcome" data-tone={outcome.tone} role={outcome.tone === "done" ? "status" : "alert"}>
    <p className="wt-outcome-title">{icon}<span>{outcome.title}</span></p>
    {outcome.tone === "done" && outcome.detail && <p className="wt-note">{outcome.detail}</p>}
    {outcome.tone === "blocked" && <p className="wt-lead">{outcome.detail}</p>}
    {(outcome.tone === "conflict" || outcome.tone === "blocked") && outcome.files.length > 0 && <ul className="wt-list" aria-label="Files">
      {outcome.files.map((file) => <li key={file}><span className="wt-path">{file}</span></li>)}
    </ul>}
    {outcome.tone === "conflict" && <p className="wt-note">The agent can rebase and resolve these in its worktree. Land again when it is done.</p>}
  </div>;
}
