// Interactive fixture-only mockup: the child-agent control surface, with the branch a child
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
// with Review, Land and Discard kept in a pinned action dock. The list carries one line of branch
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
import { useState } from "react";
import { ChevronRightIcon, GitBranchIcon, TriangleAlertIcon } from "lucide-react";
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

type Navigate = (state: string) => void;

/** Readiness is independent of commit count: an idle child must also have a clean, unblocked branch. */
function landBlocker(item: Child): string | undefined {
  if (!item.worktree) return "This child shares its parent's folder.";
  if (item.busy || item.question) return "Stop the child before landing its branch.";
  if (item.worktree.dirty > 0) return `Commit or discard the ${String(item.worktree.dirty)} uncommitted files before landing.`;
  if (item.worktree.ahead === 0) return "There are no commits to land.";
  return undefined;
}

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
  ended?: string;
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
const status = (item: Child) => item.ended ?? (item.question !== undefined ? "Waiting for your answer" : item.busy ? "Working" : "Idle");
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
    if (worktree.ahead > 0) marks.push(<span key="ahead" className="cam-mark">{`${String(worktree.ahead)} commits ahead of main`}</span>);
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
function WorktreeFoot({ items, onNavigate }: { items: readonly Child[]; onNavigate: Navigate }) {
  const branches = items.filter((item) => item.worktree !== undefined).length;
  const landable = items.filter((item) => landBlocker(item) === undefined).length;
  return <p className="cam-foot">
    <span>{String(branches)} child worktrees. {landable === 1 ? "1 is ready to land." : `${String(landable)} are ready to land.`}</span>
    <button type="button" className="cam-foot-link" onClick={() => onNavigate("worktrees")}>Show worktrees</button>
  </p>;
}

function ChildList({ items, onNavigate }: { items: readonly Child[]; onNavigate: Navigate }) {
  const working = items.filter((item) => item.busy).length;
  return <SheetDialog title="Child agents" closeLabel="Close child agents" onClose={() => onNavigate("closed")}
    subtitle={`${String(items.length)} in this session, ${String(working)} working`}
    footer={<WorktreeFoot items={items} onNavigate={onNavigate} />}>
    {[...items].sort((a, b) => rank(a) - rank(b)).map((item) => <StatusRow key={item.name}
      tone={item.question !== undefined ? "waiting" : item.busy ? "working" : "quiet"}
      name={item.name} detail={item.agent} status={status(item)} label={`Open ${item.name}`}
      onPress={() => onNavigate(({ ui: "waiting", api: "working", review: "finished", docs: "runs" })[item.name] ?? "list")}
      below={item.worktree === undefined
        ? (item.question === undefined ? undefined : <p>{item.question}</p>)
        : <>
          <BranchLine worktree={item.worktree} />
          {item.question !== undefined && <p className="cam-ask">{item.question}</p>}
        </>} />)}
  </SheetDialog>;
}

/* -- The branch as the child's receipt, at the end of its report. -- */
function Receipt({ worktree, stage }: { worktree: Worktree; stage: "ready" | "discard" | "landed" | "discarded" | "refused" }) {
  return <RailSection end="branch">
    <div className="cam-receipt">
      {stage === "discarded" ? <p>Branch discarded. Worktree removed.</p> : <BranchLine worktree={worktree} landed={stage === "landed"} />}
      <ul className="cam-paths">{worktree.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
      {stage === "discard" && <ul className="cam-paths cam-paths-flat">
        {worktree.commits.map((commit) => <li key={commit.sha}><code>{commit.sha} {commit.subject}</code></li>)}
      </ul>}
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

/* The action dock becomes the confirmation. Its warning and both choices stay visible together. */
function DiscardConfirm({ worktree, onKeep, onDiscard }: { worktree: Worktree; onKeep: () => void; onDiscard: () => void }) {
  return <div className="cam-confirm" role="group" aria-label={`Discard ${worktree.branch}`}>
    <Consequence tone="warn" icon={<TriangleAlertIcon aria-hidden />}>
      <p><strong>{discardWords(worktree)}</strong> This cannot be undone.</p>
    </Consequence>
    <div className="cam-commands">
      <button type="button" className="cam-command" data-primary onClick={onKeep}>Keep the branch</button>
      <button type="button" className="cam-command" data-danger onClick={onDiscard}>Discard branch</button>
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
function uiRecord(answer?: string, stopped = false): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_UI },
    { kind: "call", key: "2", name: "read", summary: "docs/runs.md" },
    { kind: "output", key: "3", name: "read", isError: false, text: "# Runs\n\nGET /api/runs returns { runs: Run[] }.\nAn empty list means no run yet." },
    { kind: "block", key: "4", content: <QuestionCard asker="ui asks" question="Should the empty state show the last run, or stay blank?" answer={answer ?? (stopped ? "Question cancelled in this preview." : undefined)} /> },
  ];
}
function reviewRecord(stage: "ready" | "discard" | "landed" | "discarded" | "refused", refusal?: ReactNode): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_REVIEW },
    { kind: "call", key: "2", name: "bash", summary: "git diff --stat main" },
    { kind: "output", key: "3", name: "bash", isError: false, text: "ui/src/childAgents/ChildAgentsPanel.tsx | 41 +++++++++-----\nui/verification/README.md              | 12 ++++" },
    { kind: "out", key: "4", text: "Two things would bite a reader on the cover screen. The list never says which branch a child is on, so isolated work and shared work look the same. And a report opens as one long line with no way to see what it changed." },
    { kind: "block", key: "5", content: <Receipt worktree={child("review").worktree!} stage={stage} /> },
    ...(refusal === undefined ? [] : [{ kind: "block" as const, key: "6", content: refusal }]),
  ];
}
function docsRecord(stage: "ready" | "discard" | "landed" | "discarded" | "refused", refusal?: ReactNode): ExchangeLine[] {
  return [
    { kind: "in", key: "1", label: "Task", text: TASK_DOCS },
    { kind: "out", key: "2", text: "The guide states the cleanup rule once, and the session-worktrees page points at it. Two more edits are staged and not committed yet." },
    { kind: "block", key: "3", content: <Receipt worktree={child("docs").worktree!} stage={stage} /> },
    ...(refusal === undefined ? [] : [{ kind: "block" as const, key: "5", content: refusal }]),
  ];
}

/* Run accounting is a named destination, reachable from the header in every posture. */
const RUNS = [
  { at: "14:22", outcome: "answered", turns: 7, tokens: "18.4k", cents: 31, duration: "4m 12s" },
  { at: "13:48", outcome: "answered", turns: 3, tokens: "6.1k", cents: 12, duration: "1m 30s" },
  { at: "13:31", outcome: "stopped by you", turns: 2, tokens: "4.4k", cents: 8, duration: "48s" },
];
const TOTAL_COST = `$${(RUNS.reduce((sum, run) => sum + run.cents, 0) / 100).toFixed(2)}`;
function Runs({ name }: { name: string }) {
  return <section className="cam-runs" aria-label={`Run history for ${name}`}>
    <h3>Run history</h3>
    <p>{RUNS.length} runs · {TOTAL_COST} total</p>
    {RUNS.map((run) => <details key={run.at} className="cam-run">
      <summary><ChevronRightIcon aria-hidden /><span>{run.at} · {run.outcome}</span><span>${(run.cents / 100).toFixed(2)}</span></summary>
      <EventLine tone={run.outcome === "answered" ? "positive" : "neutral"} hollow={run.outcome !== "answered"}
        subject="worker" phrase={run.outcome} facts={[]} quoteFace="text"
        quote={`claude-sonnet-4-6 · ${run.turns} turns · ${run.tokens} tokens · ${run.duration}`} />
    </details>)}
  </section>;
}

/* The cleanup inventory has no promise about when a future scheduler will run. */
function Worktrees({ items, onNavigate }: { items: readonly Child[]; onNavigate: Navigate }) {
  return <SheetDialog title="Worktrees" subtitle="Branches the children left behind" back={{ label: "All child agents", onPress: () => onNavigate("list") }}
    closeLabel="Close worktrees" onClose={() => onNavigate("closed")}>
    <Lede>Cleanup removes a worktree only when its branch is merged, nothing is uncommitted, and no session is using it.</Lede>
    <ListSection title="Eligible for cleanup" empty="Nothing to remove." note="Rechecked before removal. No cleanup runs in this preview.">
      <ActionRow name="fix/completed-child" status="merged, clean, not in use" detail={<code>.worktrees/completed-child</code>} />
    </ListSection>
    <ListSection title="Kept" empty="Nothing kept." note="Each one says why it stays.">
      {items.filter((item) => item.worktree !== undefined).map((item) => {
        const tree = item.worktree!;
        const reason = item.busy || item.question ? `in use by ${item.name}${tree.dirty ? `; ${String(tree.dirty)} files not committed` : ""}`
          : tree.dirty ? `${String(tree.dirty)} files not committed; not merged` : "not merged yet";
        return <ActionRow key={item.name} name={tree.branch} status={reason} detail={<code>{tree.path}</code>} />;
      })}
      <ActionRow name="proto/runway-pool" status="setup did not finish" detail={<code>.worktrees/proto/runway-pool</code>} />
    </ListSection>
  </SheetDialog>;
}

type Stage = "working" | "waiting" | "ready" | "landed" | "discarded" | "discard";
type Refusal = "conflict" | "blocked" | "stale";
interface ChildProgress { stage: Stage; answer?: string }
function itemWithProgress(item: Child, progress?: ChildProgress): Child {
  if (!progress) return item;
  const terminal = progress.stage === "landed" || progress.stage === "discarded";
  return { ...item, busy: progress.stage === "working" || progress.stage === "waiting",
    question: progress.stage === "waiting" ? item.question : undefined,
    ...(terminal ? { worktree: undefined, ended: `Worktree ${progress.stage} and removed` } : {}) };
}

/** Explicitly illustrative diffs. They never read the workspace or call a server. */
const REVIEW_PATCHES: Record<string, string> = {
  "ui/src/childAgents/ChildAgentsPanel.test.tsx": "@@ child panel @@\n+ expect(panel.getByRole('button', { name: 'Review changes' })).toBeVisible();\n+ expect(panel.getByRole('button', { name: 'Land on main' })).toBeVisible();",
  "docs/reviews/2026-10-09-subagent-panel.md": "@@ review notes @@\n+ Show which branch each child owns.\n+ Keep branch actions reachable in folded landscape.",
  "docs/child-agents.md": "@@ child worktrees @@\n+ A clean, idle child branch can be reviewed before landing.",
  "docs/session-worktrees.md": "@@ cleanup @@\n- Remove a worktree after the child answers.\n+ Keep unmerged, dirty, or in-use worktrees.",
  "AGENTS.md": "@@ worktrees @@\n+ Check branch state and live ownership before cleanup.",
};
function ReviewChanges({ worktree }: { worktree: Worktree }) {
  return <section className="cam-review" aria-label="Review changes">
    <h3>Review changes</h3>
    <p>Illustrative preview diff against <code>main</code>. These patches are fixture data, not a live Git read.</p>
    {worktree.paths.map((path) => <details key={path} className="cam-diff" open>
      <summary><ChevronRightIcon aria-hidden /><code>{path}</code></summary>
      <pre tabIndex={0} aria-label={`Illustrative diff for ${path}`}>{REVIEW_PATCHES[path] ?? "@@ example change @@\n+ Child worktree support"}</pre>
    </details>)}
  </section>;
}

function RefusalNotice({ kind, branch }: { kind: Refusal; branch: string }) {
  if (kind === "conflict") return <AlertCard subject={branch} title="could not land" label="Land refused" tone="bad"
    code={"ui/src/childAgents/ChildAgentsPanel.test.tsx\ndocs/reviews/2026-10-09-subagent-panel.md"} codeLabel="Files in conflict">
    Main moved while this child worked. Resolve the conflicts in this worktree, then check again. Nothing on main changed.
  </AlertCard>;
  if (kind === "blocked") return <AlertCard subject={branch} title="cannot land yet" label="Land blocked" tone="warn">
    This session still owns active child worktrees. Inspect them before retrying. Clearing this blocker does not guarantee a conflict-free land.
  </AlertCard>;
  return <AlertCard subject={branch} title="changed while you looked" label="Discard refused" tone="warn">
    Nothing was deleted. The branch changed after the preview. Review the current state and confirm again.
  </AlertCard>;
}

/* One child, with fixture-only actions. Terminal branches never keep the old composer. */
function ChildView({ name, initialStage, initialRefusal, initialRuns = false, onNavigate: navigate, progress, onRemember }: {
  name: string; initialStage: Stage; initialRefusal?: Refusal; initialRuns?: boolean; onNavigate: Navigate;
  progress?: ChildProgress; onRemember: (name: string, progress: ChildProgress) => void;
}) {
  const [stage, setStage] = useState(progress?.stage ?? initialStage);
  const [refusal, setRefusal] = useState(initialRefusal);
  const [page, setPage] = useState<"record" | "changes" | "runs">(initialRuns ? "runs" : "record");
  const [composing, setComposing] = useState(false);
  const [answer, setAnswer] = useState<string | undefined>(progress?.answer);
  const onNavigate: Navigate = (destination) => { onRemember(name, { stage, answer }); navigate(destination); };
  const [notice, setNotice] = useState("");
  const [newTask, setNewTask] = useState(false);
  const busy = stage === "working" || stage === "waiting";
  const terminal = stage === "landed" || stage === "discarded";
  const item = { ...child(name), busy, question: stage === "waiting" ? child(name).question : undefined };
  const worktree = item.worktree!;
  const blocker = landBlocker(item);
  const mode = refusal !== undefined ? "refused" : busy ? "ready" : stage;
  const refusalCard = refusal === undefined ? undefined : <RefusalNotice kind={refusal} branch={worktree.branch} />;
  const record = name === "api" ? apiRecord().map((line) => line.kind === "out" ? { ...line, streaming: busy } : line)
    : name === "ui" ? uiRecord(answer, stage !== "waiting" && answer === undefined)
      : name === "docs" ? docsRecord(mode, refusalCard) : reviewRecord(mode, refusalCard);
  const transition = (next: Stage) => { setStage(next); setRefusal(undefined); setPage("record"); setComposing(false); };
  const stop = () => { transition("ready"); setNotice("Stopped in this preview. Files and commits are kept."); };
  const returnToBranch = () => { setPage("record"); setComposing(false); };
  const footer = terminal
    ? <div className="cam-action-dock">
        <p className="cam-action-note">{stage === "landed" ? "Landed on main." : "Branch discarded."} The old worktree is gone.</p>
        {newTask ? <>
          <p className="cam-action-note">New task destination: <strong>main</strong>, in the main checkout. This is not the removed worktree.</p>
          <ReplyBox label="New task from main" placeholder="New task from main" sendLabel="Prepare preview task"
            onSend={async (text) => { setNotice(`Preview only: prepared a new task on main: ${text}`); setNewTask(false); }} />
        </> : <button className="cam-command" data-primary onClick={() => setNewTask(true)}>Start new task from main</button>}
      </div>
    : stage === "discard" && !refusal
      ? <DiscardConfirm worktree={worktree} onKeep={() => transition("ready")} onDiscard={() => { transition("discarded"); setNotice("Preview only: no files were deleted."); }} />
      : busy || composing
        ? <>
          <div className="cam-strip"><BranchLine worktree={worktree} /></div>
          <ReplyBox key={stage === "waiting" ? "answer" : "message"}
            label={stage === "waiting" ? `Answer ${name}: ${item.question}` : `Message ${name}`}
            sendLabel={stage === "waiting" ? "Send answer" : `Send to ${name}`}
            placeholder={stage === "waiting" ? `Answer ${name}` : busy ? `Steer ${name} while it works` : `Continue ${name} on ${worktree.branch}`}
            secondary={composing && !busy ? { label: "Branch actions", onPress: returnToBranch } : undefined}
            onSend={async (text) => {
              setNotice(`Preview message to ${name}: ${text}`);
              if (stage === "waiting") { setAnswer(text); transition("working"); }
            }} />
        </>
        : <div className="cam-action-dock">
          <BranchLine worktree={worktree} />
          {(refusal || blocker) && <p id="cam-land-reason" className="cam-action-note">
            {refusal === "conflict" ? "Resolve the conflicts, then check again." : refusal === "blocked" ? "Active child worktrees still block landing." : refusal === "stale" ? "Review the updated branch before confirming discard." : blocker}
          </p>}
          <div className="cam-commands">
            <button className="cam-command" onClick={() => setPage(page === "changes" ? "record" : "changes")}>{page === "changes" ? "Back to report" : "Review changes"}</button>
            {refusal ? <button className="cam-command" data-primary onClick={() => {
              if (refusal === "blocked") onNavigate("worktrees");
              else { setRefusal(undefined); setPage("changes"); setNotice("Preview refreshed. Inspect changes before the next action."); }
            }}>{refusal === "blocked" ? "Show worktrees" : refusal === "stale" ? "Review updated branch" : "Check again"}</button>
              : <button className="cam-command" data-primary disabled={blocker !== undefined} aria-describedby={blocker ? "cam-land-reason" : undefined}
                onClick={() => { transition("landed"); setNotice("Preview only: no Git operation ran."); }}>Land on main</button>}
            <button className="cam-command" onClick={() => transition("discard")}>Discard branch</button>
            <button className="cam-command" onClick={() => { setComposing(true); setPage("record"); }}>Continue working</button>
          </div>
        </div>;
  const runLabel = `Runs (${RUNS.length}) · ${TOTAL_COST}`;
  return <SheetDialog title={item.name}
    subtitle={terminal ? `Worktree ${stage === "landed" ? "landed and removed" : "discarded and removed"}` : `${item.agent}, ${status(item)}`}
    closeLabel="Close child agents" onClose={() => onNavigate("closed")}
    back={{ label: page === "record" ? "All child agents" : "Back to record", onPress: () => page === "record" ? onNavigate("list") : setPage("record") }}
    actions={[
      { label: page === "runs" ? "Record" : runLabel, onPress: () => setPage(page === "runs" ? "record" : "runs") },
      ...(busy ? [{ label: "Stop", onPress: stop }] : []),
    ]} footer={footer}>
    {notice && <p className="cam-notice" role="status">{notice}</p>}
    {page === "runs" ? <Runs name={name} /> : page === "changes" ? <ReviewChanges worktree={worktree} />
      : <>
        <ExchangeLog lines={record} follow={busy || stage === "discard" || refusal !== undefined} empty="No messages yet." />
      </>}
    {page !== "record" && <button className="cam-foot-link" onClick={returnToBranch}>Back to branch actions</button>}
  </SheetDialog>;
}

/* Every review state is an entry into the same interactive preview. */
const states = {
  list: { label: "The list", note: "Questions first. Clean, idle branches count as ready. Worktree navigation stays in the footer." },
  working: { label: "Working on its own branch", note: "The branch stays above the input. Stop and run history stay in the header." },
  waiting: { label: "Waiting, still stoppable", note: "One answer input. Stop remains available while a question waits." },
  finished: { label: "A branch ready for review", note: "Review, Land and Discard stay in the footer. Continue working opens the composer." },
  landed: { label: "After landing", note: "The old worktree is gone. A new task explicitly starts from main." },
  discard: { label: "Discard asks in place", note: "The action dock becomes a warning and confirmation, with the branch named." },
  conflict: { label: "Land refused: a conflict", note: "Names the files and offers a recheck. It makes no clean-landing promise." },
  blocked: { label: "Land refused: still owned", note: "Names the current blocker, without claiming that resolving it guarantees success." },
  stale: { label: "Discard refused: stale preview", note: "Nothing deleted. Review the updated branch before confirming again." },
  runs: { label: "Run history", note: "A header control shows the total. Individual rows have disclosure arrows for details." },
  worktrees: { label: "Cleanup inventory", note: "Eligible versus kept, with reasons. No invented cleanup deadline." },
};
type StateName = keyof typeof states;
function isState(value: string): value is StateName { return Object.hasOwn(states, value); }

function Mockup({ initial }: { initial: string }) {
  const [state, setState] = useState(initial);
  const [progress, setProgress] = useState<Record<string, ChildProgress>>({});
  const items = Children.map((item) => itemWithProgress(item, progress[item.name]));
  if (state === "closed") return <div className="cam-closed"><h1>Child-agent preview</h1><p>All actions use local fixture state. No files or branches are changed.</p>
    <button className="cam-command" onClick={() => setState("list")}>Open child agents</button></div>;
  if (state === "worktrees") return <Worktrees items={items} onNavigate={setState} />;
  if (state === "list") return <ChildList items={items} onNavigate={setState} />;
  const name = state === "working" ? "api" : state === "waiting" ? "ui" : ["discard", "stale", "runs"].includes(state) ? "docs" : "review";
  const stage: Stage = state === "working" || state === "waiting" || state === "landed" || state === "discard" ? state : "ready";
  const refusal = state === "conflict" || state === "blocked" || state === "stale" ? state : undefined;
  return <ChildView key={state} name={name} initialStage={stage} initialRefusal={refusal} initialRuns={state === "runs"} onNavigate={setState}
    progress={progress[name]} onRemember={(key, value) => setProgress((current) => ({ ...current, [key]: value }))} />;
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
createRoot(root).render(key === "all" ? <Sheet width={width} height={height} /> : <Mockup initial={isState(key) ? key : "list"} />);
