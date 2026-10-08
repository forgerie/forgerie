import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRightIcon, CircleCheckIcon, CircleDashedIcon, CircleMinusIcon, CircleXIcon, ExternalLinkIcon, EyeIcon,
  GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, LoaderCircleIcon, MessageSquareIcon,
  RefreshCwIcon, XIcon,
} from "lucide-react";
import {
  ago, approvals, clock, commentsPrompt, duration, failedChecks, markOf, mergeBlock, sortedChecks, verdict, verdictAction,
  type CheckState, type PullCheck, type PullComment, type PullLink, type PullRequest, type PullReview, type PullTone, type PullWatch,
} from "../pullRequests/pullRequestModel";
import type { PullLoad, SessionPull } from "../pullRequests/useSessionPull";
import "./pullRequest.css";

export type { PullLoad } from "../pullRequests/useSessionPull";

export interface PullRequestBinding {
  load: PullLoad;
  link: PullLink | undefined;
  notice: SessionPull["notice"];
  writing: boolean;
  /** Milliseconds since the epoch, for "12m ago" labels. */
  now: number;
  onRefresh: () => void;
  /** Put a message in the message box. The reader sends it. */
  onAsk: (message: string) => void;
  onWatch: (on: boolean) => void;
  onLink: (number: number) => void;
  onMerge: () => void;
  onClose: () => void;
}

const TONE_ICON: Record<PullTone, typeof CircleXIcon> = {
  failed: CircleXIcon, blocked: MessageSquareIcon, waiting: CircleDashedIcon, ready: CircleCheckIcon,
  draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon,
};
const CHECK_ICON: Record<CheckState, typeof CircleXIcon> = {
  failed: CircleXIcon, cancelled: CircleMinusIcon, running: LoaderCircleIcon, queued: CircleDashedIcon, passed: CircleCheckIcon,
};
const CHECK_WORD: Record<CheckState, string> = { failed: "Failed", cancelled: "Cancelled", running: "Running", queued: "Queued", passed: "Passed" };
const STATE_WORD: Record<PullRequest["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

/**
 * Header control. The dot carries the verdict's tone, so a failed check shows
 * from the thread without opening anything; the label says it in words.
 * Without a linked pull request it stays a plain icon that opens the link form.
 */
export function PullRequestOpener({ pr, link, onOpen }: { pr?: PullRequest | undefined; link?: PullLink | undefined; onOpen: () => void }) {
  const mark = pr ? markOf(pr) : undefined;
  const label = pr ? `Pull request ${mark?.number ?? ""}: ${verdict(pr).sentence}`
    : link ? `Pull request #${String(link.number)}` : "Link a pull request";
  return <button type="button" className="icon-button quiet-button pr-opener" aria-label={label} title={label} data-tone={mark?.tone}
    data-linked={link || pr ? true : undefined} onClick={onOpen}>
    <GitPullRequestIcon aria-hidden size={18} />
    {mark && <span className="pr-dot" aria-hidden />}
  </button>;
}

/**
 * A picker row's pull request: the number, and an eye while the agent watches
 * it. The catalog carries the link, not GitHub's verdict, so a row never
 * claims a state it has not read.
 */
export function PullRequestRowMark({ link }: { link: PullLink }) {
  const watching = link.watch.kind === "watching";
  const sentence = `Pull request #${String(link.number)}${watching ? ", watched by the agent" : ""}`;
  return <span className="pr-row-mark" data-watch={link.watch.kind} title={sentence} aria-label={sentence}>
    {watching ? <EyeIcon aria-hidden /> : <GitPullRequestIcon aria-hidden />}#{link.number}
  </span>;
}

/**
 * System organism: the session's pull request as a modal. It reads; the only
 * writes are Link, Watch, and Merge. Fix and Address write a message for the
 * reader to send.
 */
export function PullRequestReview(props: PullRequestBinding) {
  return createPortal(<Review {...props} />, document.body);
}

function Review({ load, link, notice, writing, now, onRefresh, onAsk, onWatch, onLink, onMerge, onClose }: PullRequestBinding) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);
  useEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  useEffect(() => {
    const element = dialog.current;
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    element?.addEventListener("cancel", cancel);
    return () => element?.removeEventListener("cancel", cancel);
  }, [onClose]);
  const pr = load.type === "ready" ? load.value : undefined;
  const ask = (message: string) => { onClose(); onAsk(message); };
  return <dialog ref={dialog} className="tree-dialog pr-dialog" aria-labelledby={titleId}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === dialog.current; }}
    onClick={(event) => { if (event.target === dialog.current && pressedBackdrop.current) onClose(); pressedBackdrop.current = false; }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>Pull request</h2>
        {/* The head gives way first: the base is where it lands, and the session chip repeats the head. */}
        <span className="tree-count pr-where" title={pr ? `#${String(pr.number)} ${pr.head} → ${pr.base}` : undefined}>{pr ? <><b>#{pr.number}</b>
          <span className="pr-where-head">{pr.head}</span><span className="pr-where-base">→ {pr.base}</span></>
          : link ? <b>#{link.number}</b> : null}</span>
        <button type="button" className="icon-button quiet-button" aria-label="Read the pull request again" title="Read again"
          disabled={load.type === "loading"} onClick={onRefresh}><RefreshCwIcon aria-hidden size={18} /></button>
        {pr && <a className="icon-button quiet-button" href={pr.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" title="Open on GitHub">
          <ExternalLinkIcon aria-hidden size={18} /></a>}
        <button type="button" className="icon-button quiet-button" aria-label="Close pull request" title="Close" onClick={onClose}>
          <XIcon aria-hidden size={18} /></button>
      </header>
      <div className="pr-body">
        {notice && <p className="pr-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
        {load.type === "loading" && <p className="changes-message" role="status">Reading the pull request from GitHub…</p>}
        {load.type === "failed" && <div className="changes-message" role="alert"><p>{load.message}</p>
          <button type="button" onClick={onRefresh}>Try again</button></div>}
        {load.type === "none" && <LinkForm writing={writing} onLink={onLink} />}
        {pr && <PullBody pr={pr} watch={link?.watch ?? { kind: "off" }} now={now} writing={writing} onAsk={ask} onWatch={onWatch} />}
      </div>
      {pr && <MergeFoot pr={pr} writing={writing} onMerge={onMerge} />}
    </div>
  </dialog>;
}

/** No pull request is linked yet. The agent links one when it opens it; the reader can link an existing one here. */
function LinkForm({ writing, onLink }: { writing: boolean; onLink: (number: number) => void }) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const number = /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
  return <form className="pr-link" onSubmit={(event) => { event.preventDefault(); if (number && number > 0) onLink(number); }}>
    <p>No pull request is linked to this session. When the agent opens one, it links it here.</p>
    <label htmlFor={inputId}>Link an open pull request from this project's repository</label>
    <div className="pr-link-row">
      <span aria-hidden>#</span>
      <input id={inputId} inputMode="numeric" autoComplete="off" placeholder="142" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className="pr-button primary" disabled={!number || writing}>{writing ? "Linking…" : "Link"}</button>
    </div>
  </form>;
}

function PullBody({ pr, watch, now, writing, onAsk, onWatch }: { pr: PullRequest; watch: PullWatch; now: number; writing: boolean;
  onAsk: (message: string) => void; onWatch: (on: boolean) => void }) {
  const { tone, sentence } = verdict(pr);
  const Icon = TONE_ICON[tone];
  const live = pr.state === "open" || pr.state === "draft";
  const action = verdictAction(pr);
  return <>
    <section className="pr-summary" aria-label="Summary">
      <p className="pr-title" title={pr.title}>{pr.title}</p>
      <p className="pr-facts"><span className="pr-state" data-state={pr.state}>{STATE_WORD[pr.state]}</span>
        <span>{pr.author}, updated {ago(pr.updatedAt, now)} ago</span>
        <span className="pr-size">{pr.files} {pr.files === 1 ? "file" : "files"} <ins>+{pr.additions}</ins> <del>−{pr.deletions}</del></span></p>
      {/* The fix sits on the line that names the problem, so it is in view at every height. */}
      <div className="pr-verdict" data-tone={tone}><p role="status"><Icon aria-hidden size={20} /><span>{sentence}</span></p>
        {action && <button type="button" className="pr-button primary" onClick={() => onAsk(action.message)}>{action.label}</button>}</div>
    </section>
    {(live || watch.kind !== "off") && <WatchRow watch={watch} live={live} now={now} writing={writing} onWatch={onWatch} />}
    {/* What needs the reader comes first: failed checks, then open comments. */}
    {sectionOrder(pr).map((section) => section === "checks" ? <Checks key={section} pr={pr} />
      : section === "comments" ? <Comments key={section} pr={pr} live={live} now={now} onAsk={onAsk} />
      : <Reviews key={section} reviews={pr.reviews} now={now} />)}
  </>;
}

function WatchRow({ watch, live, now, writing, onWatch }: { watch: PullWatch; live: boolean; now: number; writing: boolean; onWatch: (on: boolean) => void }) {
  const text: ReactNode = watch.kind === "watching"
    ? <><b>Watching.</b> {watch.wakes === 0 ? `Since ${clock(watch.since)}. Nothing has woken the agent yet.`
      : `The agent woke ${watch.wakes === 1 ? "once" : `${String(watch.wakes)} times`}, last at ${clock(watch.lastWake ?? watch.since)}.`} Stops when it merges or closes.
      {watch.error && <> The last read failed: {watch.error}</>}</>
    : watch.kind === "stopped" ? <><b>Watching stopped {ago(watch.at, now)} ago.</b> {watch.reason}</>
    : <>Wake the agent when a check fails, all pass, someone else comments, or the branch conflicts. Each wake can use agent tokens.</>;
  return <section className="pr-watch" data-watch={watch.kind} aria-label="Watch">
    <EyeIcon aria-hidden size={18} />
    <p>{text}</p>
    {(live || watch.kind === "watching") && <button type="button" className={watch.kind === "watching" ? "pr-button" : "pr-button primary"} aria-pressed={watch.kind === "watching"}
      disabled={writing} onClick={() => onWatch(watch.kind !== "watching")}>
      {watch.kind === "watching" ? "Stop watching" : watch.kind === "stopped" ? "Watch again" : "Watch"}</button>}
  </section>;
}

function Checks({ pr }: { pr: PullRequest }) {
  const headId = useId();
  const checks = sortedChecks(pr);
  const failed = failedChecks(pr);
  const passed = pr.checks.filter((check) => check.state === "passed").length;
  // The first failure with annotations opens, so its output is the first thing read.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(failed.filter((check) => check.logTail).slice(0, 1).map((check) => check.id)));
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  // Passes carry no task. They fold into one row, one tap from view.
  const [showPassed, setShowPassed] = useState(false);
  const shown = showPassed ? checks : checks.filter((check) => check.state !== "passed");
  const folded = checks.length - shown.length;
  return <section className="pr-section" aria-labelledby={headId}>
    <div className="pr-section-head">
      <h3 id={headId}>Checks</h3>
      <span className="pr-section-count">{pr.checks.length === 0 ? "none ran" : `${String(passed)} of ${String(pr.checks.length)} passed`}</span>
    </div>
    {checks.length === 0 ? <p className="pr-empty">GitHub reports no checks on {pr.head}.</p>
      : <ul className="pr-checks">{shown.map((check) => <CheckRow key={check.id} check={check} open={open.has(check.id)} onToggle={() => toggle(check.id)} />)}
        {(folded > 0 || showPassed) && passed > 0 && <li className="pr-check" data-state="passed">
          <button type="button" className="pr-check-line pr-check-fold" aria-expanded={showPassed} onClick={() => setShowPassed(!showPassed)}>
            <CircleCheckIcon aria-hidden size={16} className="pr-check-icon" />
            <span className="pr-check-name">{showPassed ? "Hide the passed checks" : `${String(passed)} passed`}</span>
            <ChevronRightIcon aria-hidden size={16} className="pr-chevron" /></button></li>}</ul>}
  </section>;
}

function CheckRow({ check, open, onToggle }: { check: PullCheck; open: boolean; onToggle: () => void }) {
  const Icon = CHECK_ICON[check.state];
  const readout = check.seconds !== undefined ? duration(check.seconds) : CHECK_WORD[check.state];
  const body = <>
    <Icon aria-hidden size={16} className="pr-check-icon" />
    <span className="pr-check-name"><span className="sr-only">{CHECK_WORD[check.state]}: </span>{check.name}
      {!check.required && <span className="pr-check-workflow">optional</span>}</span>
    <span className="pr-check-time">{readout}</span>
  </>;
  return <li className="pr-check" data-state={check.state}>
    {check.logTail ? <button type="button" className="pr-check-line" aria-expanded={open} onClick={onToggle}>
      {body}<ChevronRightIcon aria-hidden size={16} className="pr-chevron" /></button>
      : <a className="pr-check-line" href={check.url} target="_blank" rel="noreferrer">{body}<ExternalLinkIcon aria-hidden size={14} className="pr-chevron" /></a>}
    {open && check.logTail && <div className="pr-log">
      <LogTail text={check.logTail} />
      <a href={check.url} target="_blank" rel="noreferrer">Full log on GitHub<ExternalLinkIcon aria-hidden size={13} /></a>
    </div>}
  </li>;
}

type Section = "checks" | "comments" | "reviews";
function sectionOrder(pr: PullRequest): Section[] {
  const order: Section[] = failedChecks(pr).length > 0 ? ["checks", "comments", "reviews"] : ["comments", "reviews", "checks"];
  return order.filter((section) => section === "checks" || (section === "comments" ? pr.comments.length > 0 : pr.reviews.length > 0));
}

/** GitHub's check annotations: the error is usually last, so they open scrolled to the end. */
function LogTail({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => { const element = ref.current; if (element) element.scrollTop = element.scrollHeight; }, [text]);
  return <pre ref={ref} tabIndex={0} aria-label="Check annotations">{text}</pre>;
}

const REVIEW_WORD: Record<PullReview["state"], string> = { approved: "approved", changes_requested: "asked for changes", commented: "commented" };
function Reviews({ reviews, now }: { reviews: readonly PullReview[]; now: number }) {
  const headId = useId();
  return <section className="pr-section" aria-labelledby={headId}>
    <div className="pr-section-head"><h3 id={headId}>Reviews</h3></div>
    <ul className="pr-reviews">{reviews.map((review) => <li key={review.reviewer} data-state={review.state}>
      {review.state === "approved" ? <CircleCheckIcon aria-hidden size={16} /> : review.state === "changes_requested" ? <CircleXIcon aria-hidden size={16} /> : <MessageSquareIcon aria-hidden size={16} />}
      <span><b>{review.reviewer}</b> {REVIEW_WORD[review.state]}</span><span className="pr-ago">{ago(review.updatedAt, now)}</span>
    </li>)}</ul>
  </section>;
}

function Comments({ pr, live, now, onAsk }: { pr: PullRequest; live: boolean; now: number; onAsk: (message: string) => void }) {
  const headId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(pr.comments.map((comment) => comment.id)));
  const picked = pr.comments.filter((comment) => chosen.has(comment.id));
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <section className="pr-section" aria-labelledby={headId}>
    <div className="pr-section-head">
      <h3 id={headId}>Open comments</h3>
      <span className="pr-section-count">{pr.comments.length} unresolved</span>
      {live && <button type="button" className="pr-button primary" disabled={picked.length === 0} onClick={() => onAsk(commentsPrompt(pr, picked))}>
        Ask the agent to address {picked.length === pr.comments.length && picked.length > 1 ? "all" : picked.length === 1 ? "it" : String(picked.length)}</button>}
    </div>
    <ul className="pr-comments">{pr.comments.map((comment) => <Comment key={comment.id} comment={comment} live={live} now={now}
      chosen={chosen.has(comment.id)} onToggle={() => toggle(comment.id)} />)}</ul>
  </section>;
}

function Comment({ comment, live, now, chosen, onToggle }: { comment: PullComment; live: boolean; now: number; chosen: boolean; onToggle: () => void }) {
  const id = useId();
  const where = comment.path ? `${comment.path}${comment.line !== undefined ? `:${String(comment.line)}` : ""}` : "the conversation";
  return <li className="pr-comment" data-chosen={live && chosen ? true : undefined}>
    {live && <input id={id} type="checkbox" checked={chosen} onChange={onToggle} aria-label={`Include ${comment.author}'s comment on ${where}`} />}
    <label htmlFor={live ? id : undefined} className="pr-comment-body">
      <span className="pr-comment-head"><b>{comment.author}</b> on <code title={where}>{where}</code><span className="pr-ago">{ago(comment.updatedAt, now)}</span></span>
      <span className="pr-comment-text">{comment.body}</span>
    </label>
  </li>;
}

/** Merge is offered only when the server's gate allows it, and confirms the exact commit the reader saw. */
function MergeFoot({ pr, writing, onMerge }: { pr: PullRequest; writing: boolean; onMerge: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => { if (!writing) setSent(false); }, [writing]);
  if (pr.state === "merged" || pr.state === "closed") return null;
  const block = mergeBlock(pr);
  const approved = approvals(pr).length;
  return <footer className="changes-foot pr-foot">
    {confirming
      ? <p role="status">Rebase {pr.head} at <code>{pr.headSha.slice(0, 7)}</code> onto {pr.base} and merge #{pr.number} on GitHub?</p>
      : <p>{block ?? `Merges with rebase.${approved === 0 ? " Nobody has approved it." : ""}`}</p>}
    {confirming && <button type="button" className="pr-button" onClick={() => setConfirming(false)}>Cancel</button>}
    <button type="button" className="primary changes-write" disabled={block !== undefined || writing}
      onClick={() => { if (confirming) { setConfirming(false); setSent(true); onMerge(); } else setConfirming(true); }}>
      <GitMergeIcon aria-hidden size={16} />{sent && writing ? "Merging…" : confirming ? "Merge now" : "Merge"}</button>
  </footer>;
}
