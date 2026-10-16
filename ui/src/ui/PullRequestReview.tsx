import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRightIcon, CircleCheckIcon, CircleDashedIcon, CirclePlayIcon, CircleMinusIcon, CircleXIcon, ExternalLinkIcon, EyeIcon,
  GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, LinkIcon, LoaderCircleIcon, MessageSquareIcon,
  PlusIcon, RefreshCwIcon, TriangleAlertIcon, XIcon,
} from "lucide-react";
import {
  pullRequestTarget, pullRequestCopy, ago, approvals, clock, commentsPrompt, duration, failedChecks, markOf, mergeBlock, sortedChecks, verdict, verdictAction, worstOf,
  type CheckState, type PullCheck, type PullComment, type PullLink, type PullRequest, type PullReview, type PullTone, type PullWatch,
} from "../pullRequests/pullRequestModel";
import type { OpenPullsResponse, PullPreviewResponse, PullItem } from "../pullRequests/pullRequestApi";
import type { PullDiscovery, PullsLoad, SessionPulls } from "../pullRequests/useSessionPull";
import "./pullRequest.css";

export type { PullsLoad } from "../pullRequests/useSessionPull";

export interface PullRequestBinding {
  load: PullsLoad;
  discovery?: PullDiscovery | undefined;
  /** The pull request on show. Undefined: none is linked, or the reader is linking another. */
  selected: number | undefined;
  onSelect: (number: number) => void;
  /** Numbers being read again; their rows keep the last read meanwhile. */
  reading: ReadonlySet<number>;
  notice: SessionPulls["notice"];
  writing: boolean;
  /** Milliseconds since the epoch, for "12m ago" labels. */
  now: number;
  onRefresh: () => void;
  /** Put a message in the message box. The reader sends it. */
  onAsk: (message: string) => void;
  onWatch: (number: number, on: boolean) => void;
  /** Resolves true once the server linked it. */
  onLink: SessionPulls["linkNumber"];
  onUnlink: (number: number) => void;
  onMerge: (number: number) => void;
  onClose: () => void;
  /**
   * A second view beside the pull requests, as one more tab: the session's
   * CI runs. `first` opens on it. Its own reread replaces the header's.
   */
  extraView?: { label: string; title: string; tone?: PullTone | undefined; content: ReactNode; first?: boolean | undefined; onRefresh?: (() => void) | undefined } | undefined;
  /** More about one linked pull request, under its checks, reviews, and comments. */
  belowPull?: ((number: number) => ReactNode) | undefined;
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

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/**
 * Header control. The dot carries the most urgent verdict among the session's
 * pull requests, so one failure shows from the thread even when another is
 * ready; the label names which one. Without a link it stays a plain icon that
 * opens the link form.
 */
export function PullRequestOpener({ pulls, links, onOpen }: { pulls: readonly PullRequest[]; links: readonly PullLink[]; onOpen: () => void }) {
  const worst = worstOf(pulls);
  const count = Math.max(links.length, pulls.length);
  const label = worst ? `${count > 1 ? `${plural(count, "pull request", "pull requests")}. Most urgent: ` : "Pull request "}#${String(worst.pr.number)}: ${verdict(worst.pr).sentence}`
    : count > 0 ? plural(count, "pull request", "pull requests") : "Link a pull request";
  return <button type="button" className="icon-button quiet-button pr-opener" aria-label={label} title={label} data-tone={worst?.tone}
    data-linked={count > 0 ? true : undefined} onClick={onOpen}>
    <GitPullRequestIcon aria-hidden size={18} />
    {worst && <span className="pr-dot" aria-hidden />}
    {count > 1 && <span className="pr-count" aria-hidden>{count}</span>}
  </button>;
}

/**
 * A picker row's pull requests: the newest number, how many more, and an eye
 * while the agent watches any of them. The catalog carries links, not
 * GitHub's verdicts, so a row never claims a state it has not read.
 */
export function PullRequestRowMark({ links }: { links: readonly PullLink[] }) {
  const newest = links.at(-1);
  if (!newest) return null;
  const watched = links.filter((link) => link.watch.kind === "watching").length;
  const more = links.length - 1;
  const sentence = `${links.length === 1 ? `Pull request #${String(newest.number)}` : `${String(links.length)} pull requests: ${links.map((link) => `#${String(link.number)}`).join(", ")}`}`
    + (watched > 0 ? `, ${watched === links.length ? (links.length === 1 ? "watched" : "all watched") : `${String(watched)} watched`} by the agent` : "");
  return <span className="pr-row-mark" data-watch={watched > 0 ? "watching" : "off"} title={sentence} aria-label={sentence}>
    {watched > 0 ? <EyeIcon aria-hidden /> : <GitPullRequestIcon aria-hidden />}#{newest.number}
    {more > 0 && <span className="pr-row-more" aria-hidden>+{more}</span>}
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

function Review({ load, discovery, selected, onSelect, reading, notice, writing, now, onRefresh, onAsk, onWatch, onLink, onUnlink, onMerge, onClose, extraView, belowPull }: PullRequestBinding) {
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
  const items = load.type === "ready" ? load.items : [];
  const [adding, setAdding] = useState(false);
  const [extraOpen, setExtraOpen] = useState(extraView?.first === true);
  const extra = extraOpen && extraView ? extraView : undefined;
  const item = adding || extra ? undefined : items.find((candidate) => candidate.link.number === selected) ?? items.at(-1);
  const pr = item?.pull ?? undefined;
  const source = item?.link.provider === "azure-devops" ? "Azure DevOps" : "GitHub";
  const ask = (message: string) => { onClose(); onAsk(message); };
  const link: SessionPulls["linkNumber"] = async (number, expected) => { if (await onLink(number, expected)) { setAdding(false); onSelect(number); return true; } return false; };
  const refresh = extra?.onRefresh ?? onRefresh;
  return <dialog ref={dialog} className="tree-dialog pr-dialog" aria-labelledby={titleId}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === dialog.current; }}
    onClick={(event) => { if (event.target === dialog.current && pressedBackdrop.current) onClose(); pressedBackdrop.current = false; }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>{extra ? extra.title : items.length > 1 ? "Pull requests" : "Pull request"}</h2>
        {/* The head gives way first: the base is where it lands, and the session chip repeats the head. */}
        <span className="tree-count pr-where" title={pr ? `#${String(pr.number)} ${pr.head} → ${pr.base}` : undefined}>{pr ? <><b>#{pr.number}</b>
          <span className="pr-where-head">{pr.head}</span><span className="pr-where-base">→ {pr.base}</span></>
          : item ? <b>#{item.link.number}</b> : null}</span>
        {/* With nothing linked there is no tab strip: the runs are one text action away, and the action leads back. */}
        {items.length === 0 && extraView && <button type="button" className="pr-head-action" onClick={() => setExtraOpen(!extraOpen)}>
          {extra ? "Link a pull request" : <><CirclePlayIcon aria-hidden size={16} />{extraView.label}</>}</button>}
        <button type="button" className="icon-button quiet-button" aria-label={items.length > 1 ? "Read the pull requests again" : "Read the pull request again"} title="Read again"
          disabled={!extra && load.type === "loading"} onClick={refresh}><RefreshCwIcon aria-hidden size={18} /></button>
        {pr && <a className="icon-button quiet-button" href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open on ${source}`} title={`Open on ${source}`}>
          <ExternalLinkIcon aria-hidden size={18} /></a>}
        <button type="button" className="icon-button quiet-button" aria-label="Close pull request" title="Close" onClick={onClose}>
          <XIcon aria-hidden size={18} /></button>
      </header>
      {items.length > 0 && <PullStrip items={items} current={item?.link.number} adding={adding && !extra} reading={reading}
        onSelect={(number) => { setAdding(false); setExtraOpen(false); onSelect(number); }} onAdd={() => { setExtraOpen(false); setAdding(true); }}
        extra={extraView ? { label: extraView.label, title: extraView.title, tone: extraView.tone, selected: extra !== undefined, onSelect: () => { setAdding(false); setExtraOpen(true); } } : undefined} />}
      <div className="pr-body">
        {notice && <p className="pr-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
        {extra?.content}
        {!extra && load.type === "loading" && <p className="changes-message" role="status">{pullRequestCopy.loading}</p>}
        {!extra && load.type === "failed" && <div className="changes-message" role="alert"><p>{load.message}</p>
          <button type="button" onClick={onRefresh}>Try again</button></div>}
        {!extra && load.type === "ready" && (items.length === 0 || adding) && <LinkForm discovery={discovery} now={now} onAsk={ask} writing={writing} first={items.length === 0}
          onLink={(number, expected) => { void link(number, expected); }} onCancel={items.length > 0 ? () => setAdding(false) : undefined} />}
        {item && !item.pull && <div className="changes-message" role="alert">
          <p>Forgerie could not read pull request #{item.link.number}. {item.error ?? ""}</p>
          <button type="button" onClick={onRefresh}>Try again</button></div>}
        {item && pr && <PullBody key={item.link.number} pr={pr} watch={item.link.watch} now={now} writing={writing} source={source} onAsk={ask}
          onWatch={(on) => onWatch(item.link.number, on)} />}
        {item && pr && item.link.provider !== "azure-devops" && belowPull?.(item.link.number)}
        {item && <UnlinkRow number={item.link.number} watching={item.link.watch.kind === "watching"} writing={writing} onUnlink={onUnlink} />}
      </div>
      {item && pr && item.link.provider !== "azure-devops" && <MergeFoot key={item.link.number} pr={pr} writing={writing} onMerge={() => onMerge(item.link.number)} />}
    </div>
  </dialog>;
}

/**
 * The session's pull requests, one tab each, plus a way to link another. Tabs
 * wrap onto more lines rather than scroll, so every pull request stays one
 * tap away at any width. Each tab names its number and what holds it.
 */
function PullStrip({ items, current, adding, reading, onSelect, onAdd, extra }: { items: readonly PullItem[]; current: number | undefined; adding: boolean;
  reading: ReadonlySet<number>; onSelect: (number: number) => void; onAdd: () => void;
  extra?: { label: string; title: string; tone?: PullTone | undefined; selected: boolean; onSelect: () => void } | undefined }) {
  return <div className="pr-strip">
    <div role="tablist" aria-label={extra ? "Pull requests and runs in this session" : "Pull requests in this session"} className="pr-tabs">
      {items.map((item) => {
        const mark = item.pull ? markOf(item.pull) : undefined;
        const Icon = mark ? TONE_ICON[mark.tone] : TriangleAlertIcon;
        const watched = item.link.watch.kind === "watching";
        const label = `#${String(item.link.number)}: ${item.pull ? verdict(item.pull).sentence : "could not be read"}${watched ? " Watched by the agent." : ""}`;
        return <button key={`${item.link.repo}#${String(item.link.number)}`} type="button" role="tab" className="pr-tab" data-tone={mark?.tone ?? "blocked"}
          aria-selected={!adding && !extra?.selected && current === item.link.number} aria-label={label} title={label} aria-busy={reading.has(item.link.number) || undefined}
          onClick={() => onSelect(item.link.number)}>
          <Icon aria-hidden size={14} className="pr-tab-icon" /><b>#{item.link.number}</b>
          <span className="pr-tab-short">{mark?.short ?? "unread"}</span>
          {watched && <EyeIcon aria-hidden size={13} className="pr-tab-eye" />}
        </button>;
      })}
      {extra && <button type="button" role="tab" className="pr-tab" data-tone={extra.tone ?? "waiting"} aria-selected={extra.selected} title={extra.title}
        onClick={extra.onSelect}><CirclePlayIcon aria-hidden size={14} className="pr-tab-icon" /><span>{extra.label}</span></button>}
    </div>
    <button type="button" className="pr-tab pr-tab-add" aria-pressed={adding || (items.length === 0 && !extra?.selected)} onClick={onAdd}><PlusIcon aria-hidden size={14} />
      {items.length === 0 ? "Link a pull request" : "Link another"}</button>
  </div>;
}

/** Removing a link is quiet and reversible: link the number again to bring it back. */
function UnlinkRow({ number, watching, writing, onUnlink }: { number: number; watching: boolean; writing: boolean; onUnlink: (number: number) => void }) {
  return <p className="pr-unlink"><button type="button" className="pr-text-button" disabled={writing} onClick={() => onUnlink(number)}>
    Unlink #{number} from this session</button>{watching ? " Its watch stops too." : ""}</p>;
}

type OpenPullsLoad = { type: "loading" } | { type: "ready"; data: OpenPullsResponse } | { type: "failed"; message: string };
type PreviewLoad = { type: "idle" } | { type: "loading"; number: number } | { type: "ready"; data: PullPreviewResponse } | { type: "failed"; message: string };
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Binding: discovery reads are isolated from linked reads and all write handlers. */
function LinkForm({ discovery, writing, first, now, onAsk, onLink, onCancel }: { discovery: PullDiscovery | undefined; writing: boolean; first: boolean; now: number;
  onAsk: (message: string) => void; onLink: (number: number, expected: { provider: PullPreviewResponse["provider"]; repo: string }) => void; onCancel?: (() => void) | undefined }) {
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState<OpenPullsLoad>({ type: "loading" });
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<PreviewLoad>({ type: "idle" });
  const [requested, setRequested] = useState<{ value: string; number: number }>();
  const target = pullRequestTarget(value);
  const invalid = value.trim() !== "" && target === undefined;
  const openPulls = discovery?.open, readPreview = discovery?.preview;
  useEffect(() => {
    const controller = new AbortController();
    setOpen({ type: "loading" });
    if (!openPulls) { setOpen({ type: "failed", message: "Open PR discovery is unavailable." }); return; }
    void openPulls(controller.signal).then(
      data => { if (!controller.signal.aborted) setOpen({ type: "ready", data }); },
      error => { if (!controller.signal.aborted) setOpen({ type: "failed", message: messageOf(error) }); },
    );
    return () => controller.abort();
  }, [openPulls, revision]);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    setPreview({ type: "loading", number: requested.number });
    if (!readPreview) { setPreview({ type: "failed", message: "PR preview is unavailable." }); return; }
    void readPreview(requested.number, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const expected = pullRequestTarget(requested.value);
      if (data.pull.number !== requested.number || expected?.repo && (expected.provider !== data.provider || expected.repo.toLowerCase() !== data.pull.repo.toLowerCase())) {
        setPreview({ type: "failed", message: "This PR URL does not belong to the session repository. Use a PR from this repository." });
      } else setPreview({ type: "ready", data });
    }, error => { if (!controller.signal.aborted) setPreview({ type: "failed", message: messageOf(error) }); });
    return () => controller.abort();
  }, [readPreview, requested]);
  const read = (number: number, input: string) => { setValue(input); setPreview({ type: "idle" }); setRequested({ number, value: input }); };
  return <>
    <form className="pr-link" onSubmit={(event) => { event.preventDefault(); if (target) read(target.number, value); }}>
      {first ? <p>{pullRequestCopy.empty}</p> : <p>A session can follow several pull requests. Each keeps its own watch.</p>}
      <label htmlFor={inputId} className="pr-link-label">{pullRequestCopy.previewLabel}</label>
      <div className="pr-link-row">
        <span className="pr-link-field" data-invalid={invalid || undefined}>
          <LinkIcon aria-hidden size={16} />
          <input id={inputId} autoComplete="off" inputMode="url" placeholder="PR number or URL" value={value} autoFocus={!first}
            aria-describedby={invalid ? hintId : undefined} aria-invalid={invalid || undefined} onChange={(event) => {
              setValue(event.target.value); setRequested(undefined); setPreview({ type: "idle" });
            }} />
        </span>
        <button type="submit" className="pr-button primary" disabled={!target || writing || preview.type === "loading"}>Preview</button>
        {onCancel && <button type="button" className="pr-button" onClick={onCancel}>Cancel</button>}
      </div>
      {invalid && <p id={hintId} className="pr-link-hint" data-invalid role="alert">{pullRequestCopy.linkInvalid}</p>}
    </form>
    {preview.type === "loading" && <p className="changes-message" role="status">Reading pull request #{preview.number}…</p>}
    {preview.type === "failed" && <p className="changes-message" role="alert">{preview.message}</p>}
    {preview.type === "ready" && <>
      <section className="pr-section" aria-label="Link preview">
        <div className="pr-section-head"><h3>Preview #{preview.data.pull.number}</h3>
          <a className="pr-button" href={preview.data.pull.url} target="_blank" rel="noreferrer">Open on {preview.data.provider === "azure-devops" ? "Azure DevOps" : "GitHub"}</a>
          <button type="button" className="pr-button primary" disabled={writing} onClick={() => onLink(preview.data.pull.number, { provider: preview.data.provider, repo: preview.data.pull.repo })}>
            {writing ? "Linking…" : `Link #${String(preview.data.pull.number)}`}</button></div>
        <p className="pr-empty">{preview.data.pull.repo}: {preview.data.pull.head} → {preview.data.pull.base}. Not linked yet.</p>
        {!preview.data.pull.complete && <p className="pr-empty" role="status">{pullRequestCopy.previewIncomplete}</p>}
      </section>
      <PullBody key={`${preview.data.provider}:${preview.data.pull.repo}:${String(preview.data.pull.number)}`} pr={preview.data.pull} now={now} writing={writing}
        source={preview.data.provider === "azure-devops" ? "Azure DevOps" : "GitHub"} onAsk={onAsk} onWatch={() => {}} />
    </>}
    <section className="pr-section" aria-label="Repository open pull requests">
      <div className="pr-section-head"><h3>{pullRequestCopy.openHeading}</h3>
        <button type="button" className="pr-button" disabled={open.type === "loading"} onClick={() => setRevision(current => current + 1)}>Read open PRs again</button></div>
      {open.type === "loading" && <p className="pr-empty" role="status">{pullRequestCopy.openLoading}</p>}
      {open.type === "failed" && <p className="pr-empty" role="alert">{open.message}</p>}
      {open.type === "ready" && <>
        <p className="pr-empty">{open.data.repo}{open.data.items.length === 0 ? " has no open pull requests." : ""}</p>
        {!open.data.complete && <p className="pr-empty" role="status">Showing the first {open.data.items.length} open PRs. Type a number to preview another.</p>}
        <ul className="pr-checks">{open.data.items.map(item => <li className="pr-check" key={item.number}>
          <button type="button" className="pr-check-line" onClick={() => read(item.number, String(item.number))}>
            <span className="pr-check-name"><span>#{item.number} {item.title}</span><span className="pr-check-workflow">{item.head} → {item.base}, {ago(item.updatedAt, now)} ago</span></span>
            <span className="pr-check-time">{STATE_WORD[item.state]}</span><span>Preview</span>
          </button></li>)}</ul>
      </>}
    </section>
  </>;
}

function PullBody({ pr, watch, now, writing, source, onAsk, onWatch }: { source: string; pr: PullRequest; watch?: PullWatch; now: number; writing: boolean;
  onAsk: (message: string) => void; onWatch: (on: boolean) => void }) {
  const { tone, sentence } = verdict(pr);
  const sourceSentence = source === "Azure DevOps" ? sentence.replaceAll("GitHub", "Azure DevOps") : sentence;
  const Icon = TONE_ICON[tone];
  const live = pr.state === "open" || pr.state === "draft";
  const action = verdictAction(pr);
  return <>
    <section className="pr-summary" aria-label="Summary">
      <p className="pr-title" title={pr.title}>{pr.title}</p>
      <p className="pr-facts"><span>{source}</span><span className="pr-state" data-state={pr.state}>{STATE_WORD[pr.state]}</span>
        <span>{pr.author}, updated {ago(pr.updatedAt, now)} ago</span>
        <span className="pr-size">{pr.files} {pr.files === 1 ? "file" : "files"} <ins>+{pr.additions}</ins> <del>−{pr.deletions}</del></span></p>
      {/* The fix sits on the line that names the problem, so it is in view at every height. */}
      <div className="pr-verdict" data-tone={tone}><p role="status"><Icon aria-hidden size={20} /><span>{sourceSentence}</span></p>
        {action && <button type="button" className="pr-button primary" onClick={() => onAsk(action.message)}>{action.label}</button>}</div>
    </section>
    {watch && (live || watch.kind !== "off") && <WatchRow watch={watch} live={live} now={now} writing={writing} onWatch={onWatch} />}
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
    {checks.length === 0 ? <p className="pr-empty">The provider reports no checks on {pr.head}.</p>
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
