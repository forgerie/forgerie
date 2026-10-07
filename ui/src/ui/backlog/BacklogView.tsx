import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, CopyIcon, EllipsisIcon, ExternalLinkIcon, InfoIcon, ListTodoIcon, RefreshCwIcon, SearchIcon, Trash2Icon, TriangleAlertIcon, UnlinkIcon, XIcon } from "lucide-react";
import type { BacklogApi, BacklogClaim, BacklogDetail, BacklogItem, BacklogWarning } from "../../backlog/backlogApi";
import { accessWarnings, ageText, ageWords, bodyUnderTitle, findItem, groupBacklog, HOLDER_WORDS, holderOf, ignoredFix, isGitHub, issueNumber, itemParam, listOf, openCount, otherWarnings,
  priorityWord, projectCount, refOf, relativePath, type BacklogGroup, type BacklogLoad, type BacklogPlace, type Holder, type ItemRef, type SessionLook } from "../../backlog/backlogModel";
import type { GitHubApi } from "../../backlog/githubApi";
import { useGitHubApp, type GitHubAppPage } from "../../backlog/useGitHubApp";
import { writeClipboardText } from "../../clipboard";
import { SettingsFrame } from "../settings/SettingsFrame";
import { GitHubConnect } from "./GitHubConnect";
import "../settings/settings.css";
import "./backlog.css";

/** A page that cannot leave for GitHub, for bindings that give none. */
const NO_PAGE: GitHubAppPage = { origin: "", setupReturn: () => undefined, clearSetupReturn: () => undefined, submit: () => undefined };

/** Rows a project group shows before "Show all". Held items always show. */
const GROUP_ROWS = 8;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface BacklogBinding {
  load: BacklogLoad;
  onRefresh: () => void;
  api: Pick<BacklogApi, "detail" | "release">;
  /** The session list's view of a session: its state, name, and time. */
  look: (sessionId: string) => SessionLook | undefined;
  /** Go to the list or an item. `replace` swaps this history entry. */
  onPlace: (place: BacklogPlace, replace?: boolean) => void;
  /** Open the New session window with this item riding along. */
  onLaunch: (item: BacklogItem) => void;
  /** Open the session that holds an item. */
  onOpenSession: (claim: Extract<BacklogClaim, { kind: "claimed" }>) => void;
  /** This machine's GitHub App. Without it, the list still says when GitHub needs setting up. */
  github?: Pick<GitHubApi, "status" | "setup" | "created" | "remove"> | undefined;
  /** How the page leaves for GitHub and reads what GitHub sent back. */
  githubPage?: GitHubAppPage | undefined;
  onClose?: (() => void) | undefined;
}

/**
 * Binding: the backlog in the thread's place, as settings is. The list reads
 * every project's backlog folder; an item reads as a document with one way
 * on: start a session, or open the one that holds it.
 */
export function BacklogView({ place, binding }: { place: BacklogPlace; binding: BacklogBinding }) {
  return place.item ? <ItemPage key={itemParam(place.item)} item={place.item} binding={binding} />
    : <ListPage binding={binding} />;
}

/** A menu under a header button. A press outside or Escape closes it. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => { if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, anchor };
}

function CloseButton({ onClose }: { onClose?: (() => void) | undefined }) {
  return onClose ? <button type="button" className="picker-icon" aria-label="Close backlog" title="Close backlog" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null;
}

/** A held item's mark is its session's mark from the session list: a live ring while it works, a square while it waits for you. */
function Mark({ holder }: { holder?: Holder | undefined }) {
  return <span className="picker-mark" aria-hidden="true">{holder ? <i className="bl-mark" data-state={holder.state} /> : null}</span>;
}

function holderLine(holder: Holder) {
  return holder.name ? <>{HOLDER_WORDS[holder.state]} <em>{holder.name}</em></> : HOLDER_WORDS[holder.state];
}

function ItemRow({ item, holder, showProject, now, onOpen }: { item: BacklogItem; holder?: Holder | undefined; showProject: boolean; now: number; onOpen: () => void }) {
  const priority = priorityWord(item.priority);
  const time = holder ? holder.time ?? "" : ageText(item.created, now);
  return <li><button type="button" className="bl-row" data-held={holder?.state} data-done={item.readiness === "closed" || undefined} onClick={onOpen}>
    <Mark holder={holder} />
    <span className="bl-title">{item.title}</span>
    <span className="picker-time" data-live={holder?.state === "working" || undefined}>{time}</span>
    <span className="bl-meta">
      {holder ? <span className="bl-held">{showProject ? <span className="bl-project">{item.projectName}</span> : null}{holderLine(holder)}</span>
        : <>{item.readiness === "closed" ? <span className="bl-state">Done</span> : item.readiness === "blocked" ? <span className="bl-state">Blocked</span> : null}
          {issueNumber(item) ? <span className="bl-issue" title="GitHub issue">{issueNumber(item)}</span> : null}
          {priority ? <span className="bl-priority" data-priority={item.priority?.toLowerCase()}>{priority}</span> : null}
          {item.labels.length ? <span className="bl-labels">{item.labels.join("  ")}</span> : null}</>}
    </span>
  </button></li>;
}

function CopyLines({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="bl-text-button" onClick={() => { void writeClipboardText(text).then((ok) => setCopied(ok)); }}>
    {copied ? <CheckIcon aria-hidden size={14} /> : <CopyIcon aria-hidden size={14} />}{copied ? "Copied" : label}</button>;
}

/** Brief A2: the items still show; the warning names the fix. */
function IgnoredWarning({ warning, project }: { warning: BacklogWarning; project: string }) {
  const fix = ignoredFix(warning);
  return <div className="bl-warning" role="note">
    <TriangleAlertIcon aria-hidden size={16} />
    <div className="bl-warning-text">
      {fix ? <>
        <p>Git ignores <code>.forgerie/backlog/</code> in {project}, so these items are not in the repository. To keep them in Git, replace the <code>.forgerie/</code> line in <code>.gitignore</code> with:</p>
        <pre><code>{fix}</code></pre>
        <CopyLines text={fix} label="Copy lines" />
      </> : <p>Git ignores this project's backlog folder, <code>{warning.path}</code>, so these items are not in the repository. Remove or narrow the <code>.gitignore</code> rule that matches it.</p>}
    </div>
  </div>;
}

function Group({ group, collapsed, all, look, now, onToggle, onAll, onOpen }: {
  group: BacklogGroup; collapsed: boolean; all: boolean; look: BacklogBinding["look"]; now: number;
  onToggle: () => void; onAll: () => void; onOpen: (item: BacklogItem) => void;
}) {
  const limited = group.kind === "project" && !all && group.items.length > GROUP_ROWS;
  const rows = limited ? group.items.slice(0, GROUP_ROWS) : group.items;
  return <section className="picker-group bl-group" aria-label={group.label}>
    <button type="button" className="picker-group-header" aria-expanded={!collapsed} onClick={onToggle}>
      <ChevronDownIcon className="picker-chevron" aria-hidden /><span className="picker-group-label">{group.label}</span><span className="picker-count">{group.items.length}</span>
    </button>
    {collapsed ? null : <>
      {group.ignored ? <IgnoredWarning warning={group.ignored} project={group.label} /> : null}
      {group.notes?.map((note) => <p key={`${note.kind}:${note.path}`} className="bl-note-line"><InfoIcon aria-hidden size={14} />{note.message}</p>)}
      <ul className="bl-rows">{rows.map((item) => <ItemRow key={itemParam(refOf(item))} item={item} now={now} showProject={group.kind === "held"}
        holder={item.claim ? holderOf(item.claim, look) : undefined} onOpen={() => onOpen(item)} />)}</ul>
      {limited ? <button type="button" className="picker-more" onClick={onAll}>Show all {group.items.length}</button> : null}
    </>}
  </section>;
}

/** Files that are not items, and projects that could not be read. Folded, because they are rarely the reason to open the backlog. */
function Problems({ warnings, projectName }: { warnings: readonly BacklogWarning[]; projectName: (id: string) => string | undefined }) {
  if (warnings.length === 0) return null;
  const files = warnings.filter((warning) => warning.kind === "invalid-item").length;
  const github = warnings.filter((warning) => warning.provider === "github").length;
  const projects = warnings.length - files - github;
  const parts = [files ? `${String(files)} ${files === 1 ? "file is" : "files are"} not readable as items` : "",
    projects ? `${String(projects)} ${projects === 1 ? "project" : "projects"} could not be read` : "",
    github ? `GitHub has ${String(github)} ${github === 1 ? "note" : "notes"}` : ""].filter(Boolean);
  return <details className="bl-problems">
    <summary><TriangleAlertIcon aria-hidden size={14} />{parts.join(", and ")}</summary>
    {files ? <p className="bl-problems-lede">An item needs <code>id</code> and <code>title</code> in its front matter. Other files in the folder are skipped.</p> : null}
    <ul>{warnings.map((warning) => <li key={`${warning.kind}:${warning.path}`}>
      <span className="bl-problem-where" title={warning.path}><bdi dir="ltr">{projectName(warning.projectId) ? `${projectName(warning.projectId)!}: ` : ""}{warning.path}</bdi></span>
      <span className="bl-problem-why">{warning.message}</span>
    </li>)}</ul>
  </details>;
}

function Empty({ onClose }: { onClose?: (() => void) | undefined }) {
  return <SettingsFrame title="Backlog" actions={<CloseButton onClose={onClose} />}>
    <div className="bl-empty">
      <ListTodoIcon aria-hidden size={20} />
      <strong>No backlog items yet</strong>
      <p>Forgerie lists the Markdown files in each project's <code>.forgerie/backlog/</code> folder. Ask a session to write an item there, or add the file yourself.</p>
      <p>To use another folder, set <code>backlog.dir</code> in the project's <code>.forgerie/config.json</code>.</p>
    </div>
  </SettingsFrame>;
}

function ListPage({ binding }: { binding: BacklogBinding }) {
  const { load, onRefresh, onPlace, look, onClose } = binding;
  const github = useGitHubApp(binding.github, binding.githubPage ?? NO_PAGE, onRefresh);
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const menu = useMenu();
  const now = Date.now();
  const list = listOf(load);
  const groups = useMemo(() => list ? groupBacklog(list.items, list.warnings, { filter, showDone }) : [], [list, filter, showDone]);
  const problems = useMemo(() => list ? otherWarnings(groupBacklog(list.items, list.warnings, { showDone: true }), list.warnings) : [], [list]);
  const toggle = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next; };
  const blocked = list ? accessWarnings(list.warnings) : [];
  const app = github.load.type === "ready" && github.load.value.state === "configured" ? github.load.value.app : undefined;
  // While a setup finishes, or fails, the panel must show even if nothing is listed yet.
  const githubNews = github.busy || github.error !== undefined;
  if (load.type === "ready" && list && list.items.length === 0 && problems.length === 0 && blocked.length === 0 && !githubNews) return <Empty onClose={onClose} />;
  const names = new Map(list?.items.map((item) => [item.projectId, item.projectName]));
  const open = list ? openCount(list.items) : 0;
  const more = <div className="settings-menu-anchor" ref={menu.anchor}>
    <button type="button" className="picker-icon" aria-label="Backlog commands" title="Done items and refresh" aria-haspopup="menu" aria-expanded={menu.open}
      onClick={() => menu.setOpen(!menu.open)}><EllipsisIcon aria-hidden size={16} /></button>
    {menu.open ? <div className="picker-menu" role="menu" aria-label="Backlog commands">
      <button role="menuitemcheckbox" aria-checked={showDone} onClick={() => { menu.setOpen(false); setShowDone(!showDone); }}><CheckIcon aria-hidden />Show done items</button>
      <div className="picker-menu-separator" role="separator" />
      <button role="menuitem" onClick={() => { menu.setOpen(false); onRefresh(); }}><RefreshCwIcon aria-hidden />Read the backlog again</button>
      {app ? <button role="menuitem" disabled={github.busy} onClick={() => { menu.setOpen(false); github.remove(); }}>
        <Trash2Icon aria-hidden />Remove GitHub App ({app.slug})</button> : null}
    </div> : null}
  </div>;
  return <SettingsFrame title="Backlog" actions={<>{more}<CloseButton onClose={onClose} /></>}
    status={load.type === "loading" && list ? "Reading…" : undefined}
    error={load.type === "failed" ? `Could not read the backlog: ${load.message}` : undefined}
    recovery={load.type === "failed" ? <button onClick={onRefresh}>Retry</button> : undefined}>
    <div className="bl-column">
      <div className="bl-toolbar">
        <label className="bl-filter"><SearchIcon aria-hidden size={14} /><span className="sr-only">Filter items</span>
          <input type="search" placeholder="Filter by title or label" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        {list?.items.length ? <span className="bl-total">{open} {open === 1 ? "item" : "items"} in {projectCount(list.items)} {projectCount(list.items) === 1 ? "project" : "projects"}</span> : null}
      </div>
      {blocked.length || githubNews ? <GitHubConnect load={github.load} warnings={blocked} busy={github.busy} error={github.error}
        onSetUp={github.setUp} onRefresh={onRefresh} /> : null}
      {!list ? <p className="settings-hint" role="status">Reading every project's backlog…</p>
        : groups.length === 0 ? list.items.length === 0 ? null
          : <p className="settings-hint">{filter.trim() ? <>No items match “{filter.trim()}”.</> : "Every item is done."}</p>
        : groups.map((group) => <Group key={group.key} group={group} look={look} now={now}
          collapsed={collapsed.has(group.key)} all={expanded.has(group.key) || filter.trim() !== ""}
          onToggle={() => setCollapsed(toggle(collapsed, group.key))} onAll={() => setExpanded(toggle(expanded, group.key))}
          onOpen={(item) => onPlace({ item: refOf(item) })} />)}
      <Problems warnings={problems} projectName={(id) => names.get(id)} />
    </div>
  </SettingsFrame>;
}

function Property({ label, children, hint }: { label: string; children: ReactNode; hint?: string | undefined }) {
  return <div className="agent-field"><span className="agent-field-label">{label}</span><span className="agent-field-value">{children}</span>
    {hint ? <p className="agent-field-hint">{hint}</p> : null}</div>;
}

// Item text is the author's own file. No raw HTML, no remote images, links as text.
const markdownComponents = {
  strong: "strong",
  img: ({ src, alt }: { src?: string | Blob | undefined; alt?: string | undefined }) => <a href={typeof src === "string" ? src : undefined}>{alt || "Image"}</a>,
} as const;

type DetailLoad = { type: "loading" } | { type: "failed"; message: string; missing: boolean } | { type: "ready"; value: BacklogDetail };

function ItemPage({ item: ref, binding }: { item: ItemRef; binding: BacklogBinding }) {
  const { api, load, look, onPlace, onLaunch, onOpenSession, onRefresh, onClose } = binding;
  const [detail, setDetail] = useState<DetailLoad>({ type: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [release, setRelease] = useState<"idle" | "confirm" | "running" | { error: string }>("idle");
  const menu = useMenu();
  // The list may be newer than this page's read (a claim, a release), so it wins where it has the item.
  const listed = findItem(listOf(load)?.items, ref);
  const listedClaim = listed?.claim?.claimId;
  const github = ref.provider === "github";
  useEffect(() => {
    const controller = new AbortController();
    api.detail(ref, controller.signal).then((value) => { if (!controller.signal.aborted) setDetail({ type: "ready", value }); },
      (error: unknown) => { if (!controller.signal.aborted) setDetail({ type: "failed", message: messageOf(error), missing: (error as { kind?: string }).kind === "not-found" }); });
    return () => controller.abort();
    // `ref` is rebuilt from the URL on every render; its parts are what identify the item.
  }, [api, ref.projectId, ref.itemId, ref.provider, attempt, listedClaim]);
  const back = <button type="button" className="settings-back" onClick={() => onPlace({})}><ChevronLeftIcon aria-hidden size={16} />Backlog</button>;
  if (detail.type !== "ready") {
    return <SettingsFrame back={back} title={listed?.title ?? "Backlog item"} actions={<CloseButton onClose={onClose} />}
      error={detail.type === "failed" ? detail.missing
        ? github ? "This issue is no longer listed. It was closed, its author is outside the repo, or the project no longer lists GitHub issues."
          : "This item is no longer in the backlog. Its file was moved, renamed, or lost its front matter."
        : `Could not read this item: ${detail.message}` : undefined}
      recovery={detail.type === "failed" && !detail.missing ? <button onClick={() => setAttempt((n) => n + 1)}>Retry</button> : undefined}>
      {detail.type === "loading" ? <p className="settings-hint" role="status">Reading the item…</p> : null}
    </SettingsFrame>;
  }
  const item = listed ?? detail.value.item;
  const { claim } = item;
  const holder = claim ? holderOf(claim, look) : undefined;
  const now = Date.now();
  const priority = priorityWord(item.priority);
  const blockers = item.blockingIds.map((id) => findItem(listOf(load)?.items, { projectId: item.projectId, itemId: id, provider: item.provider }) ?? { id, title: id });
  const doRelease = async () => {
    if (!claim) return;
    setRelease("running");
    try { await api.release(refOf(item), claim.claimId); setRelease("idle"); onRefresh(); setAttempt((n) => n + 1); }
    catch (error) { setRelease({ error: messageOf(error) }); }
  };
  // One filled button: the way on from here.
  const primary = claim?.kind === "claimed" && holder?.state !== "missing"
    ? <button type="button" className="settings-primary" onClick={() => onOpenSession(claim)}>Open session</button>
    : claim?.kind === "interrupted" || holder?.state === "missing"
      ? <button type="button" className="settings-primary" disabled={release === "running"} onClick={() => void doRelease()}>Release item</button>
    : claim ? null
    : item.readiness === "closed" ? null
    : <button type="button" className="settings-primary" disabled={item.readiness !== "ready"} title={item.readiness === "blocked" ? "Waiting on other items" : undefined}
      onClick={() => onLaunch(item)}>Start session</button>;
  const file = relativePath(item);
  const issue = isGitHub(item);
  const where = issue ? item.url ?? file : file;
  const commands = <div className="settings-menu-anchor" ref={menu.anchor}>
    <button type="button" className="picker-icon" aria-label="Item commands" aria-haspopup="menu" aria-expanded={menu.open}
      onClick={() => { menu.setOpen(!menu.open); if (release === "confirm") setRelease("idle"); }}><EllipsisIcon aria-hidden size={16} /></button>
    {menu.open ? <div className="picker-menu" role="menu" aria-label="Item commands">
      <button role="menuitem" onClick={() => { menu.setOpen(false); void writeClipboardText(where); }}><CopyIcon aria-hidden />{issue ? "Copy issue link" : "Copy file path"}</button>
      <button role="menuitem" onClick={() => { menu.setOpen(false); onRefresh(); setAttempt((n) => n + 1); }}><RefreshCwIcon aria-hidden />{issue ? "Read the issue again" : "Read the file again"}</button>
      {claim ? <button role="menuitem" data-tone="danger" disabled={release === "running"}
        onClick={() => { if (release === "confirm") { menu.setOpen(false); void doRelease(); } else setRelease("confirm"); }}>
        <UnlinkIcon aria-hidden />{release === "confirm" ? "Release? The session keeps running" : "Release item"}</button> : null}
    </div> : null}
  </div>;
  return <SettingsFrame back={back} title={item.title} actions={<>{primary}{commands}<CloseButton onClose={onClose} /></>}
    error={typeof release === "object" ? `Could not release the item: ${release.error}` : undefined}>
    <article className="bl-item">
      {holder && claim ? <div className="bl-claim" data-state={holder.state}>
        <Mark holder={holder} />
        <div className="bl-claim-text">
          <p>{holder.name ? <>{HOLDER_WORDS[holder.state]} <strong>{holder.name}</strong></> : HOLDER_WORDS[holder.state]}</p>
          <p className="bl-claim-where">{claimDetail(claim, holder, now)}</p>
        </div>
      </div> : null}
      <h2 className="agent-name bl-item-title">{item.title}</h2>
      <div className="agent-properties">
        <Property label="Project">{item.projectName}</Property>
        {priority ? <Property label="Priority"><span className="bl-priority" data-priority={item.priority?.toLowerCase()}>{priority}</span></Property> : null}
        {item.labels.length ? <Property label="Labels"><span className="bl-chips">{item.labels.map((label) => <span key={label} className="bl-chip">{label}</span>)}</span></Property> : null}
        {blockers.length ? <Property label="Waiting on" hint="A session can start once these items are done.">
          <span className="bl-blockers">{blockers.map((blocker) => <button key={blocker.id} type="button" className="bl-link"
            onClick={() => onPlace({ item: { projectId: item.projectId, itemId: blocker.id, provider: item.provider } })}>{blocker.title}</button>)}</span></Property> : null}
        {ageWords(item.created, now) ? <Property label={issue ? "Opened" : "Added"}>{ageWords(item.created, now)}</Property> : null}
        {issue ? <Property label="Issue">{item.url
          ? <a className="bl-issue-link" href={item.url} target="_blank" rel="noopener noreferrer"><bdi dir="ltr">{file}</bdi><ExternalLinkIcon aria-hidden size={14} /></a>
          : <span className="bl-file"><bdi dir="ltr">{file}</bdi></span>}</Property>
          : <Property label="File"><span className="bl-file" title={file}><bdi dir="ltr">{file}</bdi></span>
          <button type="button" className="icon-button quiet-button" aria-label="Copy file path" title="Copy file path" onClick={() => void writeClipboardText(file)}>
            <CopyIcon aria-hidden size={14} /></button></Property>}
        {item.status ? <Property label={issue ? "Status on GitHub" : "Status in file"} hint={claim ? "Forgerie shows the session that holds the item, not this field." : undefined}>{item.status}</Property> : null}
      </div>
      {issue ? <p className="bl-note-line bl-untrusted"><InfoIcon aria-hidden size={14} />
        Someone on GitHub wrote this issue. Read it before you start a session: the session gets it as quoted text and is told not to follow instructions in it.</p> : null}
      <div className="markdown bl-body">
        <Streamdown className="markdown-content" mode="static" controls={false} skipHtml linkSafety={{ enabled: false }} components={markdownComponents}>
          {bodyUnderTitle(detail.value.body, item.title)}</Streamdown>
      </div>
    </article>
  </SettingsFrame>;
}

function claimDetail(claim: BacklogClaim, holder: Holder, now: number): string {
  const since = Date.parse(claim.claimedAt);
  const ago = Number.isFinite(since) ? ` ${ageWords(new Date(since).toISOString(), now)?.toLowerCase() ?? ""}` : "";
  switch (holder.state) {
    case "starting": return "Forgerie is creating its session. It shows in the session list once it starts.";
    case "interrupted": return `Forgerie restarted while it was starting a session in ${claim.cwd}. Check that folder, then release the item to start again.`;
    case "missing": return "That session was not found. Release the item to start a new one.";
    default: {
      const branch = claim.kind === "claimed" && claim.branch ? `${claim.branch}, ` : "";
      return `${branch}started${ago}. Archive that session to free this item.`;
    }
  }
}
