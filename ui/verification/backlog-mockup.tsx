// Static hi-fi mockup: the backlog and its launcher. No runtime, no network.
// ?state=<name> renders one state at the page's real size.
// ?state=all renders every state, each in its own frame (an iframe, so each one
// is a real viewport); &size=<w>x<h> picks the frame size, folded portrait by default.
//
// Settled (brief amendments 2026-10-06): one backlog folder per project,
// `.forgerie/backlog/` unless `backlog.dir` says otherwise; tracked by default with
// a warning when ignored; claims live only in Forgerie, never in the item file;
// Launch opens the New session window filled in, and you confirm.
// Provisional (not decided): which frontmatter fields the list reads, and that a
// live claim outranks the file's own `status`.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AnvilIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, EllipsisIcon, FileTextIcon, FolderIcon, ListTodoIcon,
  MicIcon, PaperclipIcon, SearchIcon, SettingsIcon, SquarePenIcon, TriangleAlertIcon, XIcon, ZapIcon } from "lucide-react";
import { AppShell } from "../src/ui/AppShell";
import { SettingsFrame } from "../src/ui/settings/SettingsFrame";
import "../src/ui/theme.css";
import "../src/ui/settings/settings.css";
import "./backlog-mockup.css";

// ---- Fixture: real items from this machine's repositories, aged against 2026-10-06. ----
type Priority = "high" | "medium" | "low";
type ClaimState = "working" | "blocked" | "open";
interface Claim { session: string; branch: string; state: ClaimState; since: string }
interface Item { id: string; project: string; title: string; priority: Priority; labels: string[]; age: string; file: string; status: string; claim?: Claim | undefined; body?: ReactNode }

const NESTED: Item = { id: "01M2JYFC90DDHPPPVXWN33884M", project: "forgerie", title: "Make a delegated agent's nested transcript openable from the Agents panel",
  priority: "high", labels: ["agents-panel", "sessions", "observability", "subagents"], age: "21d",
  file: "work/items/parking-lot/01M2JYFC90DDHPPPVXWN33884M-make-a-delegated-agent-s-nested-transcript-openable-from-the.md", status: "To Do", body: <>
    <h3>Why it matters</h3>
    <p>The Agents panel lists delegated agents and offers “Open transcript”, but the command fails for the common case. pi-subagents writes fresh-context children to a nested path, while the catalog scanner lists only top-level <code>*.jsonl</code> files one level deep. Measured on this machine: 8,946 nested transcripts exist on disk and 0 appear in the session list.</p>
    <h3>Acceptance criteria</h3>
    <ul>
      <li>Open transcript on a finished fresh-context agent shows that agent's transcript.</li>
      <li>The fix does not add 8,946 nested files to the inbox or to the scan cost without a deliberate decision.</li>
      <li>A regression test covers a nested <code>&lt;runId&gt;/run-N/session.jsonl</code> path end to end.</li>
    </ul></> };
const DEPLOYS: Item = { id: "01M0DZG8Q1Y0NWYEAM3177F662", project: "forgerie", title: "Make local Forgerie deployments atomic across concurrent work",
  priority: "high", labels: ["deployment", "reliability", "concurrency"], age: "48d", file: "work/items/parking-lot/01M0DZG8Q1Y0NWYEAM3177F662-make-local-forgerie-deployments-atomic-across-concurrent-wor.md",
  status: "To Do", claim: { session: "Atomic deploys", branch: "feat/atomic-deploys", state: "working", since: "41m" }, body: <>
    <h3>Why it matters</h3>
    <p>Concurrent builds clean and replace the shared dist directory in place. This caused a transient 404 and deployed unrelated dirty chat changes that regressed bottom-first opening by 3,042 px. A deployment must publish one verified commit without exposing partial output or uncommitted work.</p>
    <h3>Acceptance criteria</h3>
    <ul>
      <li>Build into a commit-specific temporary directory instead of the live dist directory.</li>
      <li>Atomically switch the live artifact only after a successful build.</li>
      <li>Serialize deployments so concurrent agents cannot overwrite each other.</li>
    </ul></> };
const AUDIO: Item = { id: "task-013", project: "nix-on-rocks", title: "Bring up RK3566 RK817 audio in guest", priority: "high", labels: ["audio", "rk3566"], age: "124d",
  file: "backlog/task-013 - bring-up-rk3566-rk817-audio-in-guest.md", status: "To Do", claim: { session: "RK817 audio bring-up", branch: "main", state: "blocked", since: "2h" } };

const forgerie: Item[] = [
  NESTED,
  { ...NESTED, id: "a", title: "Enforce exclusive terminating handoff tool batches", labels: ["handoff", "agent-loop", "reliability"], age: "35d" },
  { ...NESTED, id: "b", title: "Stop verify-staged hook from mutating worktree Git metadata", labels: ["git", "tooling", "worktree", "reliability"], age: "35d" },
  { ...NESTED, id: "c", title: "Stop sessiond startup from bumping every resumed session's modified time", labels: ["inbox", "sessiond", "correctness"], age: "35d" },
  { ...NESTED, id: "d", title: "Tell extensions why a dialog closed, so a timeout is not reported as a user cancel", priority: "medium", labels: ["extensions", "dialogs", "truthfulness"], age: "34d" },
  { ...NESTED, id: "e", title: "Cap the Pinned group's share of a short inbox pane", priority: "medium", labels: ["inbox", "intrinsic-design"], age: "35d" },
];
const rocks: Item[] = [
  { ...AUDIO, id: "f", claim: undefined, title: "Produce bootable RG353M SD image with recovery acceptance", labels: ["image", "recovery"] },
  { ...AUDIO, id: "g", claim: undefined, title: "Make RK3566 seed compatibility model-aware", labels: ["seed"] },
  { ...AUDIO, id: "h", claim: undefined, title: "Stabilize RG353M WiFi and Bluetooth path", priority: "medium", labels: ["wifi", "bluetooth"] },
];
const bazzar: Item[] = [
  { id: "i", project: "bazzar", title: "Implement LowRes NX official gallery source plugin", priority: "medium", labels: ["plugins"], age: "125d", file: ".forgerie/backlog/task-059.md", status: "To Do" },
  { id: "j", project: "bazzar", title: "Preserve plugin-supplied source candidate group IDs", priority: "low", labels: ["plugins"], age: "125d", file: ".forgerie/backlog/task-058.md", status: "To Do" },
];

// ---- States ----
interface State { label: string; note: string; page: "list" | "item" | "empty"; item?: Item; sheet?: boolean; dialog?: "launch" | "refused"; collapsed?: string[] }
const states: Record<string, State> = {
  list: { label: "Backlog", note: "Items from every project in one list. Items that a session holds come first, with that session's state.", page: "list" },
  entry: { label: "Way in", note: "Backlog sits above Settings at the foot of the session list. A session started from an item carries the item's mark.", page: "list", sheet: true },
  item: { label: "An item", note: "The file reads as a document. Start session is the one filled button.", page: "item", item: NESTED },
  claimed: { label: "An item a session holds", note: "The session is the truth, not the file. Open session replaces Start session.", page: "item", item: DEPLOYS },
  launch: { label: "Launch", note: "The New session window, filled in. The item goes with the first message. You confirm.", page: "item", item: NESTED, dialog: "launch" },
  refused: { label: "Already taken", note: "Another session took the item first. Nothing started, and the draft stays.", page: "item", item: NESTED, dialog: "refused" },
  ignored: { label: "Ignored by git", note: "The warning names the two lines that fix it. The items still show.", page: "list", collapsed: ["forgerie", "claimed", "rocks"] },
  empty: { label: "No items yet", note: "Says where Forgerie looks and how to point it elsewhere.", page: "empty" },
};

// ---- Pieces ----
const claimWords: Record<ClaimState, string> = { working: "Working in", blocked: "Waiting for you in", open: "Open in" };
const priorityWord = (priority: Priority) => priority[0]!.toUpperCase() + priority.slice(1);

function Mark({ state }: { state?: ClaimState | undefined }) {
  return <span className="picker-mark" aria-hidden="true">{state ? <i className="bl-mark" data-state={state} /> : null}</span>;
}

function ItemRow({ item, showProject }: { item: Item; showProject?: boolean | undefined }) {
  const { claim } = item;
  return <li><button type="button" className="bl-row" data-claimed={claim ? claim.state : undefined}>
    <Mark state={claim?.state} />
    <span className="bl-title">{item.title}</span>
    <span className="picker-time" data-live={claim?.state === "working" || undefined}>{claim ? claim.since : item.age}</span>
    <span className="bl-meta">
      {claim ? <span className="bl-held">{showProject ? <span className="bl-project">{item.project}</span> : null}
        {claimWords[claim.state]} <em>{claim.session}</em></span>
        : <><span className="bl-priority" data-priority={item.priority}>{priorityWord(item.priority)}</span>
          <span className="bl-labels">{item.labels.join("  ")}</span></>}
    </span>
  </button></li>;
}

function Group({ name, count, rows, collapsed, children, showProject }: {
  name: string; count: number; rows: Item[]; collapsed?: boolean | undefined; children?: ReactNode; showProject?: boolean | undefined;
}) {
  return <section className="picker-group bl-group">
    <button type="button" className="picker-group-header" aria-expanded={!collapsed}>
      <ChevronDownIcon className="picker-chevron" aria-hidden /><span className="picker-group-label">{name}</span><span className="picker-count">{count}</span>
    </button>
    {collapsed ? null : <>{children}<ul className="bl-rows">{rows.map((item) => <ItemRow key={item.id} item={item} showProject={showProject} />)}</ul>
      {count > rows.length ? <button type="button" className="picker-more">Show all {count}</button> : null}</>}
  </section>;
}

function IgnoredWarning() {
  return <div className="bl-warning" role="note">
    <TriangleAlertIcon aria-hidden size={16} />
    <div className="bl-warning-text">
      <p>Git ignores <code>.forgerie/backlog/</code> in bazzar, so these items are not in the repository. To keep them in git, replace the <code>.forgerie/</code> line in <code>.gitignore</code> with:</p>
      <pre><code>.forgerie/*{"\n"}!.forgerie/backlog/</code></pre>
      <button type="button" className="bl-text-button"><CopyIcon aria-hidden size={14} />Copy lines</button>
    </div>
  </div>;
}

function BacklogList({ collapsed = [] }: { collapsed?: string[] | undefined }) {
  const more = <button type="button" className="picker-icon" aria-label="Backlog commands" title="Grouping and done items"><EllipsisIcon aria-hidden size={16} /></button>;
  return <SettingsFrame title="Backlog" actions={more}>
    <div className="bl-column">
      <div className="bl-toolbar">
        <label className="bl-filter"><SearchIcon aria-hidden size={14} /><input placeholder="Filter by title or label" readOnly /></label>
        <span className="bl-total">63 items in 3 projects</span>
      </div>
      <Group name="In a session" count={2} rows={[DEPLOYS, AUDIO]} collapsed={collapsed.includes("claimed")} showProject />
      <Group name="forgerie" count={49} rows={forgerie} collapsed={collapsed.includes("forgerie")} />
      <Group name="nix-on-rocks" count={12} rows={rocks} collapsed={collapsed.includes("rocks")} />
      <Group name="bazzar" count={2} rows={bazzar}><IgnoredWarning /></Group>
    </div>
  </SettingsFrame>;
}

function Empty() {
  return <SettingsFrame title="Backlog">
    <div className="bl-empty">
      <ListTodoIcon aria-hidden size={20} />
      <strong>No backlog items yet</strong>
      <p>Forgerie lists the Markdown files in each project's <code>.forgerie/backlog/</code> folder. Ask a session to write an item there, or add the file yourself.</p>
      <p>To use another folder, set <code>backlog.dir</code> in the project's <code>.forgerie/config.json</code>.</p>
    </div>
  </SettingsFrame>;
}

function Property({ label, children, hint }: { label: string; children: ReactNode; hint?: string | undefined }) {
  return <div className="agent-field"><span className="agent-field-label">{label}</span><span className="agent-field-value">{children}</span>
    {hint ? <p className="agent-field-hint">{hint}</p> : null}</div>;
}

function ItemPage({ item }: { item: Item }) {
  const { claim } = item;
  const back = <button type="button" className="settings-back"><ChevronLeftIcon aria-hidden size={16} />Backlog</button>;
  const actions = <>
    <button type="button" className="settings-primary">{claim ? "Open session" : "Start session"}</button>
    <button type="button" className="picker-icon" aria-label="Item commands"><EllipsisIcon aria-hidden size={16} /></button>
  </>;
  return <SettingsFrame back={back} title={item.title} actions={actions}>
    <article className="bl-item">
      {claim ? <div className="bl-claim">
        <Mark state={claim.state} />
        <div className="bl-claim-text">
          <p>{claimWords[claim.state]} <strong>{claim.session}</strong></p>
          <p className="bl-claim-where">{item.project} · {claim.branch} · started {claim.since} ago. Archive that session to free this item.</p>
        </div>
      </div> : null}
      <h2 className="agent-name bl-item-title">{item.title}</h2>
      <div className="agent-properties">
        <Property label="Project">{item.project}</Property>
        <Property label="Priority"><span className="bl-priority" data-priority={item.priority}>{priorityWord(item.priority)}</span></Property>
        <Property label="Labels"><span className="bl-chips">{item.labels.map((label) => <span key={label} className="bl-chip">{label}</span>)}</span></Property>
        <Property label="Added">{item.age.replace("d", " days")} ago</Property>
        <Property label="File"><span className="bl-file" title={item.file}><bdi dir="ltr">{item.file}</bdi></span>
          <button type="button" className="icon-button quiet-button" aria-label="Copy file path"><CopyIcon aria-hidden size={14} /></button></Property>
        <Property label="Status in file" hint={claim ? "Forgerie shows the session that holds the item, not this field." : undefined}>{item.status}</Property>
      </div>
      <div className="markdown bl-body">{item.body}</div>
    </article>
  </SettingsFrame>;
}

// ---- The New session window, filled in from the item. Same markup and classes as NewSessionDialog. ----
function LaunchWindow({ item, refused }: { item: Item; refused: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="ns-dialog" aria-label="New session">
    <div className="ns-window composer">
      <header className="ns-head">
        <span className="ns-crumb"><span className="ns-badge" aria-hidden><AnvilIcon size={14} /></span>
          <ChevronRightIcon aria-hidden size={14} /><h2>New session</h2></span>
        <button type="button" className="icon-button quiet-button ns-close" aria-label="Close new session"><XIcon aria-hidden size={18} /></button>
      </header>
      <div className="ns-scroll">
        <div className="ns-context">
          <div className="destination"><FolderIcon aria-hidden size={14} /><span className="destination-lead">Start in</span>
            <button type="button" className="destination-trigger"><span className="destination-value">forgerie · main</span><ChevronDownIcon aria-hidden size={14} /></button></div>
          <span className="ns-with">with<button type="button" className="model-trigger"><span className="model-trigger-name">Claude Opus 5.5</span>
            <span className="model-trigger-level">High</span><ChevronDownIcon aria-hidden size={14} /></button></span>
        </div>
        <div className="ns-body">
          <div className="bl-carry" data-refused={refused || undefined}>
            <FileTextIcon aria-hidden size={18} />
            <span className="bl-carry-text">
              <span className="bl-carry-title">{item.title}</span>
              <span className="bl-carry-where">{refused ? <>Taken by <em>Subagent transcripts</em> 2 minutes ago</> : "Backlog item. The whole file goes with the first message."}</span>
            </span>
            <button type="button" className="icon-button quiet-button" aria-label="Start without this item"><XIcon aria-hidden size={16} /></button>
          </div>
          {/* The refusal sits under the item it is about, so a short window still shows it without a scroll. */}
          {refused ? <div className="bl-refusal" role="alert">
            <p>Subagent transcripts took this item first, so this session did not start. Your message is still here.</p>
            <span className="bl-refusal-actions"><button type="button">Open Subagent transcripts</button><button type="button">Start without the item</button></span>
          </div> : null}
          <div className="ns-input bl-input" data-empty={refused ? undefined : true}>
            {refused ? "Start with the scanner. Keep nested runs out of the inbox." : "Add anything the item does not say, or start with the item as written…"}
          </div>
        </div>
        <div className="ns-chips">
          <button type="button" className="ns-chip"><PaperclipIcon aria-hidden size={14} />Attach</button>
          <button type="button" className="ns-chip" aria-pressed="false"><ZapIcon aria-hidden size={14} />Rapidfire</button>
          <span className="composer-dictation"><button type="button" className="icon-button" aria-label="Dictate"><MicIcon aria-hidden size={16} /></button></span>
        </div>
        {refused ? null : <p className="bl-note">Starting gives this item to the new session until you archive it.</p>}
      </div>
      <footer className="ns-foot">
        <button type="button" className="ns-discard">Discard draft</button>
        <button type="button" className="ns-start primary" disabled={refused}>Start session</button>
      </footer>
    </div>
  </dialog>;
}

// ---- The session list, as Picker.tsx draws it, plus the Backlog row. ----
interface MockSession { title: string; where: string; branch?: string; time: string; state: string; live?: boolean; fromBacklog?: boolean }
function SessionRow({ title, where, branch, time, state, live, fromBacklog }: MockSession) {
  return <div className="picker-row" role="option" aria-selected={false} data-state={state}>
    <span className="picker-mark" aria-hidden="true"><i /></span>
    <span className="picker-title">{title}</span>
    <span className="picker-time" data-live={live || undefined}>{time}</span>
    <span className="picker-sub"><span className="picker-where">{where}{branch ? <> · <span className="picker-branch">{branch}</span></> : null}</span>
      {fromBacklog ? <span className="bl-from" title="Started from a backlog item"><ListTodoIcon aria-hidden size={12} /></span> : null}</span>
  </div>;
}
const sessionGroups: { label: string; kind: string; rows: MockSession[] }[] = [
  { label: "Blocked on you", kind: "blocked", rows: [{ title: "RK817 audio bring-up", where: "nix-on-rocks", time: "2h", state: "blocked", fromBacklog: true }] },
  { label: "Working", kind: "working", rows: [{ title: "Atomic deploys", where: "forgerie", branch: "feat/atomic-deploys", time: "41m", state: "working", live: true, fromBacklog: true }] },
  { label: "Last hour", kind: "band", rows: [{ title: "Backlog launcher mockup", where: "forgerie", branch: "feat/mvp-backlog-mockup", time: "3m", state: "open" },
    { title: "Session picker states", where: "forgerie", time: "38m", state: "open" }] },
  { label: "Today", kind: "band", rows: [{ title: "Pace homepage rethink", where: "pace", time: "4h", state: "open" }, { title: "Central Caliper UI", where: "caliper", time: "6h", state: "open" }] },
];

function MockPicker() {
  return <section className="picker" aria-label="Sessions">
    <header className="picker-header">
      <h2 className="picker-brand"><AnvilIcon aria-hidden />Forgerie</h2>
      <button className="picker-icon" aria-label="More session commands"><EllipsisIcon aria-hidden size={16} /></button>
      <button className="picker-icon" aria-label="Close sessions"><XIcon aria-hidden size={16} /></button>
    </header>
    <button className="picker-new"><SquarePenIcon aria-hidden size={16} />New session</button>
    <div className="picker-list">
      {sessionGroups.map((group) => <div key={group.label} className="picker-group" data-kind={group.kind}>
        <button className="picker-group-header" aria-expanded="true"><ChevronDownIcon className="picker-chevron" aria-hidden />
          <span className="picker-group-label">{group.label}</span><span className="picker-count">{group.rows.length}</span></button>
        <div className="picker-group-rows">{group.rows.map((row) => <SessionRow key={row.title} {...row} />)}</div>
      </div>)}
    </div>
    <div className="picker-footer">
      <button className="picker-new bl-entry" aria-current="page"><ListTodoIcon aria-hidden size={16} />Backlog<span className="bl-entry-count">63</span></button>
      <button className="picker-new"><SettingsIcon aria-hidden size={16} />Settings</button>
    </div>
  </section>;
}

function Screen({ state }: { state: State }) {
  const page = state.page === "empty" ? <Empty /> : state.page === "item" && state.item ? <ItemPage item={state.item} /> : <BacklogList collapsed={state.collapsed} />;
  return <>
    <AppShell open={!!state.sheet} onOpenChange={() => undefined} picker={() => <MockPicker />} thread={page} />
    {state.dialog && state.item ? <LaunchWindow item={state.item} refused={state.dialog === "refused"} /> : null}
  </>;
}

function Sheet({ width, height }: { width: number; height: number }) {
  return <div className="mock-sheet" style={{ gridTemplateColumns: `repeat(auto-fill, ${String(width)}px)` }}>
    {Object.entries(states).map(([key, state]) => <figure key={key} className="mock-frame">
      <figcaption><strong>{state.label}</strong><span>{state.note}</span></figcaption>
      <iframe title={state.label} src={`?state=${key}`} width={width} height={height} className="mock-device" />
    </figure>)}
  </div>;
}

const params = new URLSearchParams(location.search);
const key = params.get("state") ?? "all";
const [width = 475, height = 638] = (params.get("size") ?? "475x638").split("x").map(Number);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
if (key === "all") document.documentElement.classList.add("mock-sheet-page");
createRoot(root).render(key === "all" ? <Sheet width={width} height={height} /> : <Screen state={states[key] ?? states["list"]!} />);
