// Static hi-fi mockup: the child-agent control surface, with the branch a child
// leaves behind, the commands on it, the cleanup inventory and the run
// accounting the server now offers. No runtime, no network.
// ?state=<name> renders one state full page; ?state=all&size=WxH renders a sheet.
//
// Design plan
// -----------
// Subject: a parent agent's delegated work. A child runs alone, may own its own
// git worktree, may ask a question, and reports back to the same chat.
// Job: make each child legible at a glance, and its branch actionable, without
// turning the panel into a git dashboard.
// The one idea: the branch is the child's receipt. A finished child's report
// ends with the branch it produced, hung from the same rail as a reply's work,
// with the two commands that act on it. The list carries one line of branch
// state, marked only when it wants a decision.
// Palette: the app's tokens only. Waiting and working are --live; a landable
// branch is --ink-good; uncommitted files and a blocked land are --ink-warn; a
// conflict is --ink-bad. No new colour, no new typeface.
// Type: prose in Public Sans; a branch, a path, a count and a run figure in
// JetBrains Mono.
// Rejected: a worktree table with coloured chips (a generic dashboard); a
// per-child progress bar (a run is not a sequence); a git-graph glyph column
// (decoration); a separate cleanup screen (the job is automatic, so it becomes
// one foot line and one view behind it); a second dialog for the destructive
// confirmation (it asks in place, where the command stood).
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { GitBranchIcon, TriangleAlertIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./child-agents-mockup.css";
import { SheetDialog } from "../src/ui/SheetDialog";
import { StatusRow } from "../src/ui/StatusRow";
import { EventLine } from "../src/ui/EventLine";
import { RailSection } from "../src/ui/RailSection";
import { AlertCard } from "../src/ui/AlertCard";
import { Consequence } from "../src/ui/Consequence";
import { QuestionCard } from "../src/ui/QuestionCard";
import { ExchangeLog, type ExchangeLine } from "../src/ui/ExchangeLog";
import { ReplyBox } from "../src/ui/ReplyBox";
import { ListSection } from "../src/ui/ListSection";
import { ActionRow } from "../src/ui/ActionRow";
import { Lede } from "../src/ui/Lede";

const noop = () => undefined;
const noopAsync = async () => undefined;

interface Commit { sha: string; subject: string }
interface Worktree {
  branch: string;
  path: string;
  ahead: number;
  /** Files not committed. Zero means clean. */
  dirty: number;
  commits: readonly Commit[];
  paths: readonly string[];
}
interface Child {
  name: string;
  agent: string;
  busy: boolean;
  question?: string;
  worktree?: Worktree;
}

const Children: readonly Child[] = [
  { name: "ui", agent: "design-engineer", busy: false, question: "Should the empty state show the last run, or stay blank?",
    worktree: { branch: "fix/child-agents-polish", path: ".worktrees/child-agents-polish", ahead: 0, dirty: 4, commits: [],
      paths: ["ui/src/ui/ExchangeLog.css", "ui/src/childAgents/ChildAgentsPanel.tsx", "ui/src/childAgents/fixtures/children.ts", "ui/verification/README.md"] } },
  { name: "api", agent: "worker", busy: true,
    worktree: { branch: "feat/child-run-records", path: ".worktrees/child-run-records", ahead: 3, dirty: 0,
      commits: [{ sha: "a4f1c09", subject: "Add run history and filtering" }, { sha: "7d20e51", subject: "Record cost and turns per run" }, { sha: "1b90cc3", subject: "Keep 90 days of run records" }],
      paths: ["src/server/sessions/durableChildRuns.ts", "src/server/sessions/durableChildRoutes.ts", "docs/child-agents.md"] } },
  { name: "review", agent: "reviewer", busy: false,
    worktree: { branch: "review/subagent-panel", path: ".worktrees/subagent-panel-review", ahead: 3, dirty: 0,
      commits: [{ sha: "8f3a1c2", subject: "Note the panel's branch gap" }, { sha: "2ce9ab4", subject: "Add the review report" }, { sha: "b71d0e3", subject: "Check the cover screen at 475" }],
      paths: ["docs/reviews/2026-10-09-subagent-panel.md", "ui/src/childAgents/ChildAgentsPanel.test.tsx"] } },
  { name: "docs", agent: "worker", busy: false,
    worktree: { branch: "docs/children-guide", path: ".worktrees/children-guide", ahead: 2, dirty: 3,
      commits: [{ sha: "c31ab77", subject: "Add the children guide" }, { sha: "5f0d2a1", subject: "Spell out the cleanup rule" }],
      paths: ["docs/child-agents.md", "docs/session-worktrees.md", "AGENTS.md"] } },
];

const child = (name: string): Child => Children.find((candidate) => candidate.name === name)!;
const status = (item: Child) => item.question !== undefined ? "Waiting for your answer" : item.busy ? "Working" : "Idle";
const rank = (item: Child) => item.question !== undefined ? 0 : item.busy ? 1 : 2;

/* -- The branch, as one line. A mark takes colour only when it wants a
      decision: a landable branch, or files that are not committed yet. -- */
function BranchLine({ worktree, landed = false }: { worktree: Worktree; landed?: boolean }) {
  const marks: ReactNode[] = [];
  if (landed) {
    const tip = worktree.commits[0]?.sha;
    marks.push(<span key="landed" className="cam-mark" data-tone="good">{tip === undefined ? "landed on main" : `landed on main as ${tip}`}</span>);
    marks.push(<span key="gone" className="cam-mark">worktree removed</span>);
  }
  else {
    if (worktree.ahead > 0) marks.push(<span key="ahead" className="cam-mark" data-tone="good">{`${String(worktree.ahead)} commits ahead of main`}</span>);
    if (worktree.dirty > 0) marks.push(<span key="dirty" className="cam-mark" data-tone="warn">{`${String(worktree.dirty)} files not committed`}</span>);
    if (worktree.ahead === 0 && worktree.dirty === 0) marks.push(<span key="none" className="cam-mark">nothing committed yet</span>);
  }
  return <p className="cam-line">
    <GitBranchIcon aria-hidden />
    <code className="cam-branch">{worktree.branch}</code>
    {marks}
  </p>;
}

/* -- The foot of the list: what the reader can do about the branches. -- */
function WorktreeFoot() {
  const branches = Children.filter((item) => item.worktree !== undefined).length;
  const landable = Children.filter((item) => item.worktree !== undefined && !item.busy && item.worktree.ahead > 0).length;
  return <p className="cam-foot">
    <span>{String(branches)} child worktrees. {landable === 1 ? "1 is ready to land." : `${String(landable)} are ready to land.`}</span>
    <button type="button" className="cam-foot-link" onClick={noop}>Show worktrees</button>
  </p>;
}

function ChildList({ foot = false }: { foot?: boolean }) {
  const working = Children.filter((item) => item.busy).length;
  return <SheetDialog title="Child agents" closeLabel="Close child agents" onClose={noop}
    subtitle={`${String(Children.length)} in this session, ${String(working)} working`}>
    {[...Children].sort((a, b) => rank(a) - rank(b)).map((item) => <StatusRow key={item.name}
      tone={item.question !== undefined ? "waiting" : item.busy ? "working" : "quiet"}
      name={item.name} detail={item.agent} status={status(item)} label={`Open ${item.name}`} onPress={noop}
      below={item.worktree === undefined
        ? (item.question === undefined ? undefined : <p>{item.question}</p>)
        : <>
          <BranchLine worktree={item.worktree} />
          {item.question !== undefined && <p className="cam-ask">{item.question}</p>}
        </>} />)}
    {foot && <WorktreeFoot />}
  </SheetDialog>;
}

/* -- The branch as the child's receipt, at the end of its report. -- */
function Receipt({ worktree, stage }: { worktree: Worktree; stage: "ready" | "discard" | "landed" | "refused" }) {
  return <RailSection end="branch">
    <div className="cam-receipt">
      <BranchLine worktree={worktree} landed={stage === "landed"} />
      <ul className="cam-paths">{worktree.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
      {stage === "ready" && <div className="cam-commands">
        <button type="button" className="cam-command" data-primary onClick={noop}>Land on main</button>
        <button type="button" className="cam-command" onClick={noop}>Discard branch</button>
      </div>}
      {stage === "discard" && <DiscardConfirm worktree={worktree} />}
    </div>
  </RailSection>;
}

/** The one sentence a reader must read before they delete someone's work. */
function discardWords(worktree: Worktree): string {
  const { branch, ahead, dirty } = worktree;
  const parts = [branch];
  if (ahead > 0) parts.push(`its ${ahead === 1 ? "1 commit" : `${String(ahead)} commits`}`);
  if (dirty > 0) parts.push(`${String(dirty)} uncommitted ${dirty === 1 ? "file" : "files"}`);
  if (parts.length === 1) return `Discarding deletes ${branch}. Nothing is uncommitted.`;
  const lost = dirty > 0 ? ` The uncommitted ${dirty === 1 ? "file is" : "files are"} deleted with it.` : "";
  return `Discarding deletes ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!}.${lost}`;
}

/* The confirmation stands where the command stood: the branch stays in view
   while the reader decides about it, and the chapter asks once, in place. */
function DiscardConfirm({ worktree }: { worktree: Worktree }) {
  const shown = worktree.commits.slice(0, 2);
  const rest = worktree.commits.length - shown.length;
  return <div className="cam-confirm" role="group" aria-label={`Discard ${worktree.branch}`}>
    <Consequence tone="warn" icon={<TriangleAlertIcon aria-hidden />}>
      <p><strong>{discardWords(worktree)}</strong> This cannot be undone.</p>
    </Consequence>
    <ul className="cam-paths cam-paths-flat">
      {shown.map((commit) => <li key={commit.sha}><code><span className="cam-sha">{commit.sha}</span>{commit.subject}</code></li>)}
      {rest > 0 && <li><code>and {String(rest)} more {rest === 1 ? "commit" : "commits"}</code></li>}
    </ul>
    <div className="cam-commands">
      <button type="button" className="cam-command" data-primary onClick={noop}>Keep the branch</button>
      <button type="button" className="cam-command" data-danger onClick={noop}>Discard branch</button>
    </div>
  </div>;
}

/* -- One child's record, built the way the real panel builds it. -- */
const TASK_API = "Add run history to the child panel: one record per run with the agent, the model, the turns, the cost and how it ended. The contract is in `docs/child-agents.md`.";
const TASK_UI = "Add an empty state to the run list. The API contract is in docs/runs.md.";
const TASK_REVIEW = "Review the subagent panel changes. Report anything that would bite a reader on the folded cover screen.";
const TASK_DOCS = "Write the children guide, and pull the cleanup rule out of the session-worktrees page so it is stated once.";

function apiRecord(): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_API },
    { kind: "call", key: "2", name: "read", summary: "docs/child-agents.md" },
    { kind: "output", key: "3", name: "read", isError: false, text: "# Durable child agents\n\n## API\n\nGET /sessions/:id/children returns DurableChildSummary[]." },
    { kind: "call", key: "4", name: "bash", summary: "npx vitest run durableChildRuns" },
    { kind: "output", key: "5", name: "bash", isError: false, text: "Test Files  1 passed (1)\nTests  12 passed (12)" },
    { kind: "out", key: "6", streaming: true, text: "One record per run now lands under the data dir, and the read API filters by session and by agent. A run that a restart interrupted records as stopped. Next I will" },
  ];
}
function uiRecord(): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_UI },
    { kind: "call", key: "2", name: "read", summary: "docs/runs.md" },
    { kind: "output", key: "3", name: "read", isError: false, text: "# Runs\n\nGET /api/runs returns { runs: Run[] }.\nAn empty list means no run yet." },
    { kind: "block", key: "4", content: <QuestionCard asker="ui asks" question="Should the empty state show the last run, or stay blank?" /> },
  ];
}
function reviewRecord(stage: "ready" | "landed" | "refused", refusal?: ReactNode): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_REVIEW },
    { kind: "call", key: "2", name: "bash", summary: "git diff --stat main" },
    { kind: "output", key: "3", name: "bash", isError: false, text: "ui/src/childAgents/ChildAgentsPanel.tsx | 41 +++++++++-----\nui/verification/README.md              | 12 ++++" },
    { kind: "out", key: "4", text: "Two things would bite a reader on the cover screen. The list never says which branch a child is on, so isolated work and shared work look the same. And a report opens as one long line with no way to see what it changed." },
    { kind: "block", key: "5", content: <Receipt worktree={child("review").worktree!} stage={stage} /> },
    ...(refusal === undefined ? [] : [{ kind: "block" as const, key: "6", content: refusal }]),
  ];
}
function docsRecord(stage: "ready" | "discard" | "refused", refusal?: ReactNode): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_DOCS },
    { kind: "out", key: "2", text: "The guide states the cleanup rule once, and the session-worktrees page points at it. Two more edits are staged and not committed yet." },
    { kind: "block", key: "3", content: <Receipt worktree={child("docs").worktree!} stage={stage} /> },
    ...(refusal === undefined ? [] : [{ kind: "block" as const, key: "5", content: refusal }]),
  ];
}

/* -- The run accounting: one quiet fold at the foot of the record. -- */
/* -- The run accounting: one quiet fold at the foot of the record. Opened, it
      shows each run as the app draws one: an event line whose facts open. -- */
function Runs({ name, open = false }: { name: string; open?: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    body.current?.querySelectorAll("details").forEach((node) => { node.setAttribute("open", ""); });
  }, [open]);
  return <details className="cam-runs" open={open}>
    <summary>3 runs in {name}</summary>
    <div ref={body}>
    <EventLine tone="positive" subject="worker" phrase="answered" time="14:22"
      facts={[{ label: "model", value: "claude-sonnet-4-6" }, { label: "turns", value: "7" }, { label: "tokens", value: "18.4k" }, { label: "cost", value: "$0.31" }, { label: "took", value: "4m 12s" }]} />
    <EventLine tone="positive" subject="worker" phrase="answered" time="13:48"
      facts={[{ label: "model", value: "claude-sonnet-4-6" }, { label: "turns", value: "3" }, { label: "tokens", value: "6.1k" }, { label: "cost", value: "$0.12" }, { label: "took", value: "1m 30s" }]} />
    <EventLine tone="neutral" hollow subject="worker" phrase="stopped by you" time="13:31"
      facts={[{ label: "model", value: "claude-sonnet-4-6" }, { label: "turns", value: "2" }, { label: "tokens", value: "4.4k" }, { label: "cost", value: "$0.08" }, { label: "took", value: "48s" }]} />
    </div>
  </details>;
}

/* -- The cleanup inventory: the one view behind the foot line. -- */
function Worktrees() {
  return <SheetDialog title="Worktrees" subtitle="Branches the children left behind" back={{ label: "All child agents", onPress: noop }}
    closeLabel="Close worktrees" onClose={noop}>
    <Lede>Cleanup removes a worktree only when its branch is merged, nothing is uncommitted, and no session is using it.</Lede>
    <ListSection title="Will be removed" empty="Nothing to remove." note="These run on the next pass, within five minutes.">
      <ActionRow name="review/subagent-panel" status="merged, clean" detail={<code>.worktrees/subagent-panel-review</code>} />
    </ListSection>
    <ListSection title="Kept" empty="Nothing kept." note="Each one says why it stays.">
      <ActionRow name="feat/child-run-records" status="4 files not committed" detail={<code>.worktrees/child-run-records</code>} />
      <ActionRow name="fix/child-agents-polish" status="not merged yet" detail={<code>.worktrees/child-agents-polish</code>} />
      <ActionRow name="chore/bun-packaging" status="in use by a session" detail={<code>.worktrees/bun-packaging</code>} />
      <ActionRow name="proto/runway-pool" status="setup did not finish" detail={<code>.worktrees/proto/runway-pool</code>} />
    </ListSection>
  </SheetDialog>;
}

/* -- One child, open. `follow` is on whenever the reader has just acted, so
      the thing that answered them is brought into view. -- */
function ChildView({ name, stage, runs = false, runsOpen = false, follow = false, refusal }: {
  name: string;
  stage: "working" | "waiting" | "ready" | "landed" | "discard";
  runs?: boolean;
  runsOpen?: boolean;
  follow?: boolean;
  refusal?: ReactNode;
}) {
  const item = child(name);
  // A refusal takes the commands away: the card carries the retry, and leaving
  // the failed command in place would invite the same press twice.
  const receipt: "ready" | "discard" | "landed" | "refused" =
    refusal !== undefined ? "refused" : stage === "discard" ? "discard" : stage === "landed" ? "landed" : "ready";
  const record = name === "api" ? apiRecord() : name === "ui" ? uiRecord()
    : name === "docs" ? docsRecord(receipt, refusal)
    : reviewRecord(receipt, refusal);
  const busy = stage === "working";
  const question = stage === "waiting" ? item.question : undefined;
  // The branch sits on the input, not at the top of the record: it is context
  // for the act of steering, so it stays visible while the record scrolls.
  const branch = (stage === "working" || stage === "waiting") && item.worktree !== undefined
    ? <div className="cam-strip"><BranchLine worktree={item.worktree} /></div> : null;
  const input = question !== undefined
    ? <ReplyBox label={`Answer ${name}: ${question}`} sendLabel="Send answer" autoFocus placeholder={`Answer ${name}`} onSend={noopAsync} />
    : <ReplyBox label={`Message ${name}`} sendLabel={`Send to ${name}`} placeholder={busy ? `Steer ${name} while it works` : `Give ${name} another task`} onSend={noopAsync} />;
  return <SheetDialog title={item.name} subtitle={`${item.agent}, ${status(item)}`}
    closeLabel="Close child agents" onClose={noop} back={{ label: "All child agents", onPress: noop }}
    actions={busy ? [{ label: "Stop", onPress: noop }] : []} footer={<>{branch}{input}</>}>
    <ExchangeLog lines={record} follow={follow || busy || question !== undefined} empty="No messages yet." />
    {runs && <Runs name={name} open={runsOpen} />}
  </SheetDialog>;
}

/* -- The refusals. Each one is local, and each names the next move. -- */
function Conflict() {
  return <AlertCard subject="review/subagent-panel" title="could not land" label="Land refused" tone="bad"
    code={"ui/src/childAgents/ChildAgentsPanel.test.tsx and docs/reviews/2026-10-09-subagent-panel.md"} codeLabel="Files in conflict"
    actions={[{ label: "Open the worktree", onPress: noop }, { label: "Try again", onPress: noop }]}>
    Main moved while this child worked, and two files conflict. Resolve them in the worktree, then land it again. Nothing on main changed.
  </AlertCard>;
}
function Blocked() {
  return <AlertCard subject="review/subagent-panel" title="cannot land yet" label="Land blocked" tone="warn"
    actions={[{ label: "Show worktrees", onPress: noop }]}>
    This session still owns two active child worktrees, and they start from the same commit. Land or discard those first, then this branch lands cleanly.
  </AlertCard>;
}
function Stale() {
  return <AlertCard subject="docs/children-guide" title="changed while you looked" label="Discard refused" tone="warn"
    actions={[{ label: "Look again", onPress: noop }]}>
    Nothing was deleted. The branch moved after this preview was made, so the confirmation no longer matches it.
  </AlertCard>;
}

/* -- Every state, once. -- */
const states: Record<string, { label: string; note: string; view: () => ReactNode }> = {
  list: { label: "The list", note: "Questions first. A child with its own branch carries one line of branch state, marked only when it wants a decision.", view: () => <ChildList foot /> },
  working: { label: "Working on its own branch", note: "The branch sits on the input, where the reader steers. Stop stays in the header.", view: () => <ChildView name="api" stage="working" runs /> },
  waiting: { label: "A question, one input", note: "The question is a card where it was asked. The one input at the foot answers it. No second box.", view: () => <ChildView name="ui" stage="waiting" /> },
  finished: { label: "The branch as a receipt", note: "A finished child's report ends with the branch it produced, and the commands that act on it.", view: () => <ChildView name="review" stage="ready" /> },
  landed: { label: "After landing", note: "The receipt becomes a record: what landed, and that the worktree went.", view: () => <ChildView name="review" stage="landed" /> },
  discard: { label: "Discard asks in place", note: "The confirmation stands where the command stood, so the branch stays in view while the reader decides.", view: () => <ChildView name="docs" stage="discard" follow /> },
  conflict: { label: "Land refused: a conflict", note: "Names the files and the next move. Main is untouched.", view: () => <ChildView name="review" stage="ready" follow refusal={<Conflict />} /> },
  blocked: { label: "Land refused: still owned", note: "A session cannot land while it owns other child worktrees from the same commit.", view: () => <ChildView name="review" stage="ready" follow refusal={<Blocked />} /> },
  stale: { label: "Discard refused: stale preview", note: "A branch that changed after the preview deletes nothing, and says so.", view: () => <ChildView name="docs" stage="discard" follow refusal={<Stale />} /> },
  runs: { label: "The run accounting", note: "One quiet fold at the foot of the record: model, turns, tokens, cost, and how each run ended.", view: () => <ChildView name="docs" stage="ready" runs runsOpen /> },
  worktrees: { label: "The cleanup inventory", note: "One view behind the list's foot line. Every kept branch says why it stays.", view: () => <Worktrees /> },
};

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
createRoot(root).render(key === "all" ? <Sheet width={width} height={height} /> : <>{states[key]?.view() ?? <ChildList foot />}</>);
