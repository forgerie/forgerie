// Interactive fixture-only mockup: a saved workflow from offer to landing.
// No runtime, no network. Buttons move between states.
// ?state=<name> renders one state full page; add &nav=1 for the flow bar.
// ?state=all&size=WxH&zoom=Z renders the storyboard.
//
// Design plan
// -----------
// Subject: a saved workflow (contract, design and build in parallel, review,
// land) that the agent offers when the conversation is ready for it.
// Job: show what will happen before it starts, keep the main chat free while
// it runs, show every worker on request, and stop for the reader only at the
// points the workflow names.
// The one idea: the route. One drawing of the workflow, stops on a line with
// parallel workers as tracks, appears in four sizes: a line in the offer, the
// full route in the plan, a strip of bars above the composer, and the live
// route in the run sheet. The reader learns one picture. A stop that waits on
// the reader is a ring in the live colour; a change the agent proposes is a
// dashed stop.
// Palette: the app's tokens only. Working and waiting are --live; done is
// --ink-good; a must-fix finding is --ink-warn. No new colour, no new typeface.
// Type: prose in Public Sans; an agent, a model, a branch, a path, a figure in
// JetBrains Mono, as in the child-agent views.
// Rejected: a Mermaid diagram for the plan (fixed scale, scrolls to read, cannot
// carry live state); a kanban board of stages (a dashboard, not a conversation);
// a percentage bar (a workflow is not linear in time); a separate workflow page
// outside the chat (the reader asked to stay in the conversation).
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, FileTextIcon, GitBranchIcon, MicIcon, PlusIcon, TriangleAlertIcon, WorkflowIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./workflow-mockup.css";
import { SheetDialog } from "../src/ui/SheetDialog";
import { EventLine } from "../src/ui/EventLine";
import { QuestionCard } from "../src/ui/QuestionCard";
import { ExchangeLog, type ExchangeLine } from "../src/ui/ExchangeLog";
import { ReplyBox } from "../src/ui/ReplyBox";
import { ActionFooter } from "../src/ui/ActionFooter";
import { BadgeButton } from "../src/ui/BadgeButton";
import { Lede } from "../src/ui/Lede";
import { Consequence } from "../src/ui/Consequence";

type Go = (state: string) => void;

/* ------------------------------------------------------------------ */
/* The route: one model, four drawings.                                */
/* ------------------------------------------------------------------ */

type StopState = "done" | "live" | "you" | "next" | "proposed" | "failed";
interface Worker {
  name: string;
  agent: string;
  model: string;
  /** The saved model, when this run changes it. */
  was?: string | undefined;
  branch?: string;
  state: StopState;
  activity?: string;
}
interface Stop {
  id: string;
  name: string;
  does: string;
  state: StopState;
  /** The reader is the actor at this stop. */
  you?: boolean;
  workers?: readonly Worker[];
  /** A short status after the name, such as "approved 14:06". */
  note?: string;
  detail?: ReactNode;
}

const WORD: Record<StopState, string> = {
  done: "Done", live: "Working", you: "Waiting for you", next: "Next", proposed: "Proposed", failed: "Must fix",
};

const DESIGN: Worker = { name: "design", agent: "design-engineer", model: "Claude Opus 5.5", branch: "design/run-export", state: "next" };
const BUILD: Worker = { name: "build", agent: "full-stack-engineer", model: "GPT-6.1 Mini", was: "GPT-6.1", branch: "feat/run-export-api", state: "next" };
const DOCS: Worker = { name: "docs", agent: "worker", model: "GPT-6.1 Mini", branch: "docs/run-export-route", state: "proposed" };

type At = "plan" | "contract" | "build" | "change" | "review" | "stuck" | "ready" | "landed";
const AT_ORDER: readonly At[] = ["plan", "contract", "build", "change", "review", "stuck", "ready", "landed"];

function route(at: At): Stop[] {
  const past = (step: At) => AT_ORDER.indexOf(at) > AT_ORDER.indexOf(step);
  const contract: Stop = { id: "contract", name: "Contract", does: "This chat writes the contract. You approve it.", you: true,
    state: at === "contract" ? "you" : past("contract") ? "done" : "next", ...(past("contract") ? { note: "approved by you, 14:06" } : {}) };
  const buildState: StopState = at === "build" ? "live" : past("build") ? "done" : "next";
  const build: Stop = { id: "build", name: "Design and build", does: "Two workers, each on its own branch, at the same time.", state: buildState,
    workers: [
      { ...DESIGN, state: buildState, ...(at === "build" ? { activity: "Rendering the run history sheet at 475 × 638" } : past("build") ? { activity: "5 commits" } : {}) },
      { ...BUILD, state: buildState, ...(at === "build" ? { activity: "vitest childRunsCsv: 9 passed" } : past("build") ? { activity: "5 commits" } : {}) },
    ] };
  const docs: Stop = { id: "docs", name: "Docs", does: "Adds the new route to docs/child-agents.md.", state: at === "change" ? "proposed" : "done",
    workers: [{ ...DOCS, state: at === "change" ? "proposed" : "done", ...(at === "change" ? {} : { activity: "1 commit" }) }] };
  const reviewState: StopState = at === "review" ? "live" : at === "stuck" ? "failed" : past("review") ? "done" : "next";
  const review: Stop = { id: "review", name: "Review", does: "A fresh reviewer checks every branch against the contract. Up to 2 rounds of fixes.",
    state: reviewState, workers: [{ name: "review", agent: "reviewer", model: "GPT-6.1", state: reviewState }],
    ...(at === "review" ? { note: "round 2 of 2" } : at === "stuck" ? { note: "1 finding left after round 2" } : at === "change" ? { note: "waits for your choice" } : past("review") ? { note: "passed in round 2" } : {}) };
  const land: Stop = { id: "land", name: "Land", does: "You review the branches and land them on main.", you: true,
    state: at === "ready" ? "you" : at === "landed" ? "done" : "next", ...(at === "landed" ? { note: "landed by you, 14:47" } : {}) };
  const withDocs = AT_ORDER.indexOf(at) >= AT_ORDER.indexOf("change");
  return [contract, build, ...(withDocs ? [docs] : []), review, land];
}

/** The mark at a stop: a dot for an agent, a ring when the reader is the actor. */
function Mark({ state, you }: { state: StopState; you?: boolean | undefined }) {
  return <span className="wf-mark" data-state={state} data-you={you || undefined} aria-hidden>
    {state === "done" && <CheckIcon />}
  </span>;
}

function WorkerLine({ worker }: { worker: Worker }) {
  return <span className="wf-who">
    <code className="wf-agent">{worker.agent}</code>
    <span className="wf-model">{worker.was ? <><s>{worker.was}</s> {worker.model}</> : worker.model}</span>
  </span>;
}

/** The full route: the plan sheet and the run sheet draw the same list. */
function RouteFull({ stops, onOpen }: { stops: readonly Stop[]; onOpen?: (name: string) => void }) {
  return <ol className="wf-route">
    {stops.map((stop) => <li key={stop.id} className="wf-stop" data-state={stop.state} data-you={stop.you || undefined}>
      <Mark state={stop.state} you={stop.you} />
      <div className="wf-stop-body">
        <p className="wf-stop-head">
          <span className="wf-stop-name">{stop.name}</span>
          <span className="wf-stop-word">{stop.note ?? (stop.state === "next" ? (stop.you ? "You" : "") : WORD[stop.state])}</span>
        </p>
        <p className="wf-stop-does">{stop.does}</p>
        {stop.workers && <ul className="wf-tracks">
          {stop.workers.map((worker) => {
            const body = <>
              <span className="wf-track-head"><span className="wf-dot" data-state={worker.state} aria-hidden /><code className="wf-track-name">{worker.name}</code>
                <span className="wf-track-word">{worker.state === "next" ? "" : WORD[worker.state]}</span></span>
              <WorkerLine worker={worker} />
              {worker.branch && <span className="wf-branch"><GitBranchIcon aria-hidden /><code>{worker.branch}</code></span>}
              {worker.activity && <span className="wf-activity" data-live={worker.state === "live" || undefined}>{worker.activity}</span>}
            </>;
            return <li key={worker.name} className="wf-track" data-state={worker.state}>
              {onOpen && worker.state !== "next" && worker.state !== "proposed"
                ? <button type="button" className="wf-track-button" onClick={() => onOpen(worker.name)} aria-label={`Open ${worker.name}`}>{body}<ChevronRightIcon className="wf-track-open" aria-hidden /></button>
                : <div className="wf-track-button" data-static>{body}</div>}
            </li>;
          })}
        </ul>}
        {stop.detail}
      </div>
    </li>)}
  </ol>;
}

/** The route as one line of stops, in the offer and the picker. */
function RouteLine({ stops }: { stops: readonly Stop[] }) {
  return <ol className="wf-line" aria-label="Stages">
    {stops.map((stop) => <li key={stop.id} data-state={stop.state} data-you={stop.you || undefined}>
      <Mark state={stop.state} you={stop.you} />
      <span>{stop.workers && stop.workers.length > 1 ? stop.workers.map((worker) => worker.name).join(" + ") : stop.you ? `${stop.name}, you` : stop.name}</span>
    </li>)}
  </ol>;
}

/** The route as a strip of bars above the composer. A parallel stop is stacked bars. */
function RunStrip({ stops, status, waiting = 0, go }: { stops: readonly Stop[]; status: string; waiting?: number; go: Go }) {
  return <button type="button" className="wf-strip" onClick={() => go("run")} aria-label={`Design, build, review: ${status}. Open the run.`}>
    <span className="wf-strip-bars" aria-hidden>
      {stops.map((stop) => <span key={stop.id} className="wf-strip-stop">
        {(stop.workers && stop.workers.length > 1 ? stop.workers.map((worker) => worker.state) : [stop.state]).map((state, index) =>
          <span key={index} className="wf-strip-bar" data-state={state} data-you={stop.you || undefined} />)}
      </span>)}
    </span>
    <span className="wf-strip-text">
      <WorkflowIcon aria-hidden />
      <span className="wf-strip-name">Design, build, review</span>
      <span className="wf-strip-status">{status}</span>
      {waiting > 0 && <span className="wf-strip-count">{waiting}</span>}
      <ChevronRightIcon className="wf-strip-open" aria-hidden />
    </span>
  </button>;
}

/* ------------------------------------------------------------------ */
/* The chat around it.                                                 */
/* ------------------------------------------------------------------ */

function User({ children }: { children: ReactNode }) {
  return <div className="message message-user"><div className="user-bubble message-text"><p>{children}</p></div></div>;
}
function Agent({ children, trace }: { children: ReactNode; trace?: string }) {
  return <div className="message message-assistant"><div className="message-text">
    {trace && <div className="trace-line"><span className="trace-marker" aria-hidden>{">"}</span><span className="trace-text"><span className="trace-label">{trace}</span></span></div>}
    <div className="markdown">{children}</div>
  </div></div>;
}

interface CardAction { label: string; onPress: () => void; tone?: "primary" | "danger" }
/** A card in the thread that the workflow owns: the live edge while it waits on the reader. */
function Card({ icon, title, meta, open = true, tone, children, actions, note }: {
  icon: ReactNode; title: string; meta?: ReactNode; open?: boolean; tone?: "warn";
  children?: ReactNode; actions?: readonly CardAction[] | undefined; note?: ReactNode;
}) {
  return <section className="wf-card" data-open={open || undefined} data-tone={tone} aria-label={title}>
    <header className="wf-card-head">{icon}<span className="wf-card-title">{title}</span>{meta !== undefined && <span className="wf-card-meta">{meta}</span>}</header>
    {children}
    {actions && <ActionFooter note={note} actions={actions} />}
  </section>;
}

function Composer({ text, picker = false, go }: { text?: string; picker?: boolean; go: Go }) {
  return <div className="composer">
    {picker && <WorkflowPicker go={go} />}
    <div className="composer-shell">
      <div className="composer-input wf-input">{text ? <>{text}<span className="wf-caret" /></> : <span className="wf-placeholder">Send a message...</span>}</div>
      <div className="composer-actions">
        <button className="icon-button quiet-button" aria-label="Attach"><PlusIcon size={18} /></button>
        <button className="icon-button quiet-button wf-flow-button" data-open={picker || undefined} aria-label="Workflows" onClick={() => go(picker ? "suggest" : "ask")}><WorkflowIcon size={18} /></button>
        <button className="model-trigger"><span className="model-trigger-name">Claude Opus 5.5</span><span className="model-trigger-level">High</span><ChevronDownIcon size={16} /></button>
        <button className="icon-button quiet-button" aria-label="Dictate"><MicIcon size={18} /></button>
        <span className="wf-spacer" />
        <button className="primary icon-button" aria-label="Send message"><ArrowUpIcon size={16} /></button>
      </div>
    </div>
  </div>;
}

const SHORT = (names: readonly [string, boolean][]): Stop[] => names.map(([name, you], index) => ({ id: String(index), name, does: "", state: "next", you }));
const LIBRARY = [
  { name: "Design, build, review", does: "Contract, then design and build in parallel, then a fresh review. You approve the contract and the landing.", runs: "4 runs, last on Oct 8", stops: route("plan"), fits: true },
  { name: "Design options", does: "Three designers each make one direction. You pick one, or ask for another round.", runs: "7 runs, last yesterday", fits: false,
    stops: SHORT([["Brief", true], ["3 designers", false], ["Pick", true]]) },
  { name: "Research sweep", does: "Several researchers split a question. One writer merges their findings, with sources.", runs: "2 runs, last on Oct 1", fits: false,
    stops: SHORT([["Split", false], ["4 researchers", false], ["Merge", false]]) },
];

function WorkflowPicker({ go }: { go: Go }) {
  return <div className="wf-picker" role="listbox" aria-label="Workflows">
    <p className="wf-picker-head">Workflows<span>Saved in your profile</span></p>
    {LIBRARY.map((flow) => <button key={flow.name} type="button" role="option" aria-selected={flow.fits} className="wf-picker-row" onClick={() => go("plan")}>
      <span className="wf-picker-name">{flow.name}{flow.fits && <span className="wf-fit">Fits this chat</span>}</span>
      <span className="wf-picker-does">{flow.does}</span>
      <RouteLine stops={flow.stops} />
      <span className="wf-picker-runs">{flow.runs}</span>
    </button>)}
    <p className="wf-picker-foot">You can also say it: “run design, build, review”.</p>
  </div>;
}

function Session({ children, strip, composer, badge, go }: { children: ReactNode; strip?: ReactNode; composer?: ReactNode; badge?: { count?: number; active?: boolean }; go: Go }) {
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => { const node = transcript.current; if (node) node.scrollTop = node.scrollHeight; }, []);
  return <main className="session-shell">
    <header className="session-header">
      <div className="session-heading"><h1 className="session-title">Run history export</h1></div>
      <BadgeButton icon={<BotIcon aria-hidden />} label="Child agents" count={badge?.count ?? 0} active={badge?.active ?? false} onPress={() => go("run")} />
    </header>
    <div className="thread"><div ref={transcript} className="transcript"><div className="thread-column">
      <div className="message-group">{children}</div>
      <div className="composer-region">{strip}{composer ?? <Composer go={go} />}</div>
    </div></div></div>
  </main>;
}

/* ------------------------------------------------------------------ */
/* The conversation, in order.                                         */
/* ------------------------------------------------------------------ */

function Before() {
  return <>
    <User>The child panel shows run history. I want to export it as CSV, so I can compare runs in a spreadsheet.</User>
    <Agent trace="ran 6 tools: read, bash">
      <p>Run records already hold what a CSV needs: agent, model, turns, tokens, cost, outcome, and time. Two parts change. The server needs <code>GET /sessions/:id/child-runs.csv</code>. The run history sheet needs an Export button, with an empty state and an error state.</p>
    </Agent>
    <User>Yes. Keep the columns in the order the sheet shows them.</User>
  </>;
}

function Offer({ go, open = true }: { go: Go; open?: boolean }) {
  return <Agent>
    <p>The scope is settled: one endpoint, one button, columns in sheet order. The work splits cleanly between the interface and the server, so your <strong>Design, build, review</strong> workflow fits here.</p>
    <Card icon={<WorkflowIcon aria-hidden />} title="Design, build, review" meta="Saved workflow" open={open}
      actions={open ? [{ label: "Not now", onPress: () => go("suggest") }, { label: "See the plan", onPress: () => go("plan"), tone: "primary" }] : undefined}
      note={open ? <>1 change for this run: <code>build</code> uses GPT-6.1 Mini.</> : undefined}>
      <RouteLine stops={route("plan")} />
      {!open && <p className="wf-card-closed">Started by you, 14:02.</p>}
    </Card>
  </Agent>;
}

function Started() {
  return <EventLine tone="active" subject="Design, build, review" phrase="started by you" time="14:02" quoteFace="text"
    quote="Export run history as CSV. One endpoint, one button, columns in sheet order." />;
}

function ContractCard({ go, approved = false }: { go: Go; approved?: boolean }) {
  return <Agent trace="ran 3 tools: read, write">
    <p>I wrote the contract. It fixes the endpoint, the columns, and the four states of the button.</p>
    <Card icon={<FileTextIcon aria-hidden />} title="Contract" meta={<code>docs/contracts/run-export.md</code>} open={!approved}
      actions={approved ? undefined : [{ label: "Read it", onPress: () => go("contract") }, { label: "Ask for changes", onPress: () => go("contract") }, { label: "Approve contract", onPress: () => go("building"), tone: "primary" }]}
      note={approved ? undefined : "Design and build start when you approve."}>
      <dl className="wf-facts">
        <div data-wide><dt>Endpoint</dt><dd><code>GET /sessions/:id/child-runs.csv</code></dd></div>
        <div><dt>Columns</dt><dd>started, agent, model, turns, tokens, cost, outcome</dd></div>
        <div><dt>Button</dt><dd>ready, exporting, nothing to export, failed</dd></div>
      </dl>
      {approved && <p className="wf-card-closed">Approved by you, 14:06.</p>}
    </Card>
  </Agent>;
}

function SideChat() {
  return <>
    <EventLine tone="active" subject="design, build" phrase="started" time="14:06" />
    <User>While they work: does the CSV need a byte-order mark for Excel?</User>
    <Agent><p>Only when a cell has non-ASCII text, and only for older Excel versions. Agent names and model names are ASCII, so no. If the task column joins the export later, I will tell <code>build</code>.</p></Agent>
  </>;
}

const DESIGN_ANSWER = "Header. It is an action on the whole list.";
function DesignQuestion({ go, answer }: { go: Go; answer?: string }) {
  return <QuestionCard asker="design asks" question="Should Export sit in the sheet header, beside Run history, or at the foot of the run list?"
    answer={answer} replyLabel="Answer design" placeholder="Your answer" sendLabel="Send answer"
    onAnswer={async () => go("change")} link={{ label: "Open design", onPress: () => go("child") }} />;
}

function Reports() {
  return <>
    <EventLine tone="positive" subject="design" phrase="finished" time="14:24" quoteFace="text" quote="Export is a header action. Empty and error states use the sheet's existing notice." />
    <EventLine tone="positive" subject="build" phrase="finished" time="14:26" quoteFace="text" quote="GET /sessions/:id/child-runs.csv streams rows in sheet order. 9 tests pass." />
  </>;
}

function ChangeProposal({ go, decided = false }: { go: Go; decided?: boolean }) {
  return <Agent>
    <p>Both workers finished. One thing the saved workflow does not cover: this run adds a public route, and <code>docs/child-agents.md</code> lists every route. I suggest a docs stage before the review.</p>
    <Card icon={<WorkflowIcon aria-hidden />} title="Change to this run" meta="Proposed" open={!decided}
      actions={decided ? undefined : [{ label: "Keep the plan", onPress: () => go("review") }, { label: "Add docs stage", onPress: () => go("review"), tone: "primary" }]}
      note={decided ? undefined : "This run only. You can save it to the workflow at the end."}>
      <ol className="wf-diff">
        <li data-kind="same"><Mark state="done" /><span>Contract, then design and build</span></li>
        <li data-kind="add"><Mark state="proposed" /><span><strong>Docs</strong>, before review. <code>worker</code>, GPT-6.1 Mini, on its own branch.</span></li>
        <li data-kind="same"><Mark state="next" /><span>Review, then land</span></li>
      </ol>
      {decided && <p className="wf-card-closed">Added by you, 14:27.</p>}
    </Card>
  </Agent>;
}

function ReviewReports() {
  return <>
    <EventLine tone="positive" subject="docs" phrase="finished" time="14:29" quoteFace="text" quote="Added the CSV route to docs/child-agents.md." />
    <EventLine tone="neutral" subject="review" phrase="round 1: 2 must-fix, 1 note" time="14:33" quoteFace="text" quote="Sent the fixes to design and build." />
  </>;
}

/* ------------------------------------------------------------------ */
/* Sheets.                                                             */
/* ------------------------------------------------------------------ */

function PlanSheet({ go }: { go: Go }) {
  const [mini, setMini] = useState(true);
  const stops = route("plan").map((stop) => stop.id !== "build" || mini ? stop
    : { ...stop, workers: stop.workers!.map((worker) => worker.name === "build" ? { ...worker, was: undefined, model: "GPT-6.1" } : worker) });
  return <SheetDialog title="Design, build, review" subtitle="Saved workflow, 4 stages" closeLabel="Not now" onClose={() => go("suggest")}
    footer={<ActionFooter note="It runs in this chat. You can keep talking while it works."
      actions={[{ label: "Edit saved workflow", onPress: () => go("plan") }, { label: "Start workflow", onPress: () => go("contract"), tone: "primary" }]} />}>
    <Lede>Agree a contract, build the interface and the endpoint at the same time, have a fresh reviewer check both, then land. You approve the contract and the landing.</Lede>
    <section className="wf-section" aria-label="Task">
      <h3>Task</h3>
      <div className="wf-task" contentEditable suppressContentEditableWarning>Export run history as CSV: <code>GET /sessions/:id/child-runs.csv</code>, and an Export button in the run history sheet with empty and error states. Columns in the sheet's order.</div>
      <p className="wf-hint">The agent wrote this from the chat. Edit it before you start.</p>
    </section>
    <section className="wf-section" aria-label="What happens">
      <h3>What happens</h3>
      <RouteFull stops={stops} />
    </section>
    <section className="wf-section" aria-label="Changes for this run">
      <h3>Changes for this run</h3>
      <label className="wf-change">
        <input type="checkbox" checked={mini} onChange={(event) => setMini(event.target.checked)} />
        <span><strong><code>build</code> uses GPT-6.1 Mini instead of GPT-6.1</strong><small>Suggested by the agent. The endpoint is a small read over existing records.</small></span>
      </label>
    </section>
    <section className="wf-section" aria-label="Past runs">
      <h3>Past runs</h3>
      <dl className="wf-facts">
        <div><dt>Runs</dt><dd>4, all landed</dd></div>
        <div><dt>Time</dt><dd>28 to 52 min</dd></div>
        <div><dt>Cost</dt><dd>$2.10 to $3.80</dd></div>
        <div><dt>Review</dt><dd>passed in round 1 twice, in round 2 twice</dd></div>
      </dl>
    </section>
  </SheetDialog>;
}

function Findings() {
  return <ul className="wf-findings" aria-label="Round 1 findings">
    <li data-kind="fixed"><span className="wf-finding-kind">Must fix, fixed</span><span>Export stays enabled while the list is empty. <code>design</code>, c20f7a1</span></li>
    <li data-kind="fixed"><span className="wf-finding-kind">Must fix, fixed</span><span>The cost column is in dollars. The contract says cents. <code>build</code>, 7be2d10</span></li>
    <li data-kind="note"><span className="wf-finding-kind">Note</span><span>At 475 px the header action wraps under the title. Left as is.</span></li>
  </ul>;
}

function RunSheet({ go, at }: { go: Go; at: "build" | "review" }) {
  const back = at === "build" ? "building" : "change-decided";
  const stops = route(at).map((stop) => stop.id === "review" && at === "review" ? { ...stop, detail: <Findings /> } : stop);
  return <SheetDialog title="Design, build, review" subtitle={at === "build" ? "Running for 14 min, $0.92 so far" : "Running for 33 min, $1.97 so far"}
    closeLabel="Close the run" onClose={() => go(back)} actions={[{ label: "Stop workflow", onPress: () => go(back) }]}>
    <RouteFull stops={stops} onOpen={(name) => { if (name === "design") go("child"); }} />
    <section className="wf-section" aria-label="Recent">
      <h3>Recent</h3>
      {at === "build" ? <>
        <EventLine tone="neutral" subject="build" phrase="committed" time="14:19" quoteFace="code" quote="a41c0e2 Stream child runs as CSV" />
        <EventLine tone="neutral" subject="design" phrase="committed" time="14:17" quoteFace="code" quote="9be3d18 Add the Export action to run history" />
        <EventLine tone="positive" subject="you" phrase="approved the contract" time="14:06" />
      </> : <>
        <EventLine tone="neutral" subject="design" phrase="fixed" time="14:36" quoteFace="code" quote="c20f7a1 Disable Export while the list is empty" />
        <EventLine tone="neutral" subject="build" phrase="fixed" time="14:35" quoteFace="code" quote="7be2d10 Write cost in cents, as the contract says" />
        <EventLine tone="positive" subject="you" phrase="added the docs stage" time="14:27" />
      </>}
    </section>
  </SheetDialog>;
}

const DESIGN_RECORD: ExchangeLine[] = [
  { kind: "in", key: "1", label: "Task", text: "Stage Design and build, in Design, build, review. Build the Export action and its states in the run history sheet. Contract: docs/contracts/run-export.md. Check all four Fold postures." },
  { kind: "call", key: "2", name: "read", summary: "docs/contracts/run-export.md" },
  { kind: "output", key: "3", name: "read", isError: false, text: "## Button\n\nready, exporting, nothing to export, failed" },
  { kind: "call", key: "4", name: "bash", summary: "caliper-render RunHistory.part.tsx --all-postures" },
  { kind: "output", key: "5", name: "bash", isError: false, text: "4 renders written: fold8-unfolded-portrait.png, fold8-unfolded-landscape.png, fold8-folded-portrait.png, fold8-folded-landscape.png" },
  { kind: "block", key: "6", content: <QuestionCard asker="design asks" question="Should Export sit in the sheet header, beside Run history, or at the foot of the run list?" /> },
];

function ChildSheet({ go }: { go: Go }) {
  return <SheetDialog title="design" subtitle="design-engineer, Waiting for your answer" closeLabel="Close design" onClose={() => go("question")}
    back={{ label: "Back to the run", onPress: () => go("run") }}
    actions={[{ label: "Run history", onPress: () => go("child") }, { label: "Stop", onPress: () => go("child") }]}
    footer={<>
      <p className="wf-branch wf-branch-strip"><GitBranchIcon aria-hidden /><code>design/run-export</code><span>2 commits ahead of main</span></p>
      <ReplyBox label="Answer design" placeholder="Answer design" sendLabel="Send answer" onSend={async () => go("change")} />
    </>}>
    <ExchangeLog lines={DESIGN_RECORD} follow empty="No messages yet." />
  </SheetDialog>;
}

const HISTORY = [
  { at: "Today 14:02", version: "v3, + docs", build: "GPT-6.1 Mini", time: "42 min", cost: "$2.64", rounds: "2", current: true },
  { at: "Oct 8", version: "v3", build: "GPT-6.1", time: "52 min", cost: "$3.80", rounds: "2" },
  { at: "Oct 6", version: "v3", build: "GPT-6.1", time: "31 min", cost: "$2.40", rounds: "1" },
  { at: "Oct 2", version: "v2", build: "GPT-6.1", time: "28 min", cost: "$2.10", rounds: "1" },
  { at: "Sep 29", version: "v1", build: "Claude Opus 5.5", time: "49 min", cost: "$3.45", rounds: "2" },
];

function HistorySheet({ go }: { go: Go }) {
  return <SheetDialog title="Design, build, review" subtitle="Saved workflow, version 4" closeLabel="Close" onClose={() => go("landed")}
    back={{ label: "Back to the chat", onPress: () => go("landed") }} actions={[{ label: "Edit", onPress: () => go("history") }]}>
    <Lede>Each run keeps the exact workflow text it started with, so runs of different versions can be compared side by side.</Lede>
    <div className="wf-table-scroll" tabIndex={0} role="region" aria-label="Runs">
      <table className="wf-table">
        <thead><tr><th>Run</th><th>Version</th><th><code>build</code> model</th><th>Time</th><th>Cost</th><th>Review rounds</th></tr></thead>
        <tbody>{HISTORY.map((run) => <tr key={run.at} data-current={run.current || undefined}>
          <td>{run.at}</td><td>{run.version}</td><td>{run.build}</td><td className="wf-num">{run.time}</td><td className="wf-num">{run.cost}</td><td className="wf-num">{run.rounds}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <section className="wf-section" aria-label="Versions">
      <h3>Versions</h3>
      <ol className="wf-versions">
        <li><strong>v4</strong>, today. <code>build</code> uses GPT-6.1 Mini. A docs stage runs before review when a run adds a route.</li>
        <li><strong>v3</strong>, Oct 6. Review allows 2 rounds instead of 1.</li>
        <li><strong>v2</strong>, Oct 2. <code>build</code> moved from Claude Opus 5.5 to GPT-6.1.</li>
        <li><strong>v1</strong>, Sep 29. First version.</li>
      </ol>
    </section>
  </SheetDialog>;
}

/* ------------------------------------------------------------------ */
/* States.                                                             */
/* ------------------------------------------------------------------ */

interface StateInfo { letter: string; label: string; note: string; from?: string; branch?: boolean }
const states: Record<string, StateInfo> = {
  suggest: { letter: "A", label: "The agent offers a workflow", note: "When the scope is settled, the agent names the saved workflow that fits, draws its route on one line, and states its one change for this run." },
  ask: { letter: "B", label: "Or you ask for one", branch: true, from: "instead of A", note: "The workflow button in the composer lists your saved workflows and marks the one that fits this chat. Saying it in words gives the same offer as A." },
  plan: { letter: "C", label: "The plan, before anything starts", from: "See the plan, in A or B", note: "The full route: who does what, on which branch, with which model, and where you are needed. The task and the agent's change are editable." },
  contract: { letter: "D", label: "Stop 1: you approve the contract", from: "Start workflow", note: "The strip above the composer is the same route as bars. The contract card waits on you. Nothing else starts until you approve." },
  building: { letter: "E", label: "Two workers run; the chat stays free", from: "Approve contract", note: "Design and build work on their own branches. You talk to the main agent about something else. The strip shows two live bars." },
  run: { letter: "F", label: "Watch the run", from: "the strip, or the robot", note: "The live route: each worker's branch, model, and last action. Tap a worker to open it. Stop workflow stays in the header." },
  question: { letter: "G", label: "A worker asks you", from: "while E runs", note: "The question arrives in the main chat, and you answer it there. Answering does not start a turn of the main agent. The strip counts it." },
  child: { letter: "H", label: "Open one worker", branch: true, from: "a worker in F, or Open design in G", note: "The existing child view: the full record, its branch, and one input. Back returns to the run." },
  change: { letter: "I", label: "The agent proposes a change", from: "both workers finish", note: "Something the saved workflow does not cover. The agent shows the change on the route and waits. It applies to this run only." },
  review: { letter: "J", label: "Review, round 2", from: "Add docs stage", note: "Round 1 findings, and the commits that fixed them, hang from the review stop. Round 2 checks the fixes." },
  stuck: { letter: "K", label: "Review does not pass", branch: true, from: "instead of L", note: "After the last round, the workflow stops for you. Nothing lands. You choose another round, take over, or stop." },
  ready: { letter: "L", label: "Stop 5: you land", from: "review passes", note: "One card with the result, the branches, the time, and the cost. Review the changes first, or land all three branches." },
  landed: { letter: "M", label: "Landed; keep what worked?", from: "Land all on main", note: "The agent lists how this run differed from the saved workflow, and offers to save the differences as version 4." },
  history: { letter: "N", label: "Compare runs", from: "Compare runs or Save version 4, in M", note: "Every run of the workflow, with the version it used. This is where you compare experiments." },
};

const BUILD_STOPS = route("build");

function Screen({ state, go }: { state: string; go: Go }) {
  switch (state) {
    case "ask": return <Session go={go} composer={<Composer go={go} picker />}>
      <Before /><Agent><p>Agreed: columns in sheet order. Tell me when you want to start.</p></Agent>
    </Session>;
    case "plan": return <><Session go={go}><Before /><Offer go={go} /></Session><PlanSheet go={go} /></>;
    case "contract": return <Session go={go} strip={<RunStrip stops={route("contract")} status="Contract, waiting for you" waiting={1} go={go} />}>
      <Before /><Offer go={go} open={false} /><Started /><ContractCard go={go} />
    </Session>;
    case "building": return <Session go={go} badge={{ active: true }} strip={<RunStrip stops={BUILD_STOPS} status="Design and build, 2 working" go={go} />}>
      <Started /><ContractCard go={go} approved /><SideChat />
    </Session>;
    case "run": return <><Session go={go} badge={{ active: true }} strip={<RunStrip stops={BUILD_STOPS} status="Design and build, 2 working" go={go} />}>
      <Started /><ContractCard go={go} approved /><SideChat /></Session><RunSheet go={go} at="build" /></>;
    case "question": return <Session go={go} badge={{ count: 1, active: true }} strip={<RunStrip stops={BUILD_STOPS} status="design asks you" waiting={1} go={go} />}>
      <ContractCard go={go} approved /><SideChat /><DesignQuestion go={go} />
    </Session>;
    case "child": return <><Session go={go} badge={{ count: 1, active: true }} strip={<RunStrip stops={BUILD_STOPS} status="design asks you" waiting={1} go={go} />}>
      <SideChat /><DesignQuestion go={go} /></Session><ChildSheet go={go} /></>;
    case "change": return <Session go={go} strip={<RunStrip stops={route("change")} status="Review waits for your choice" waiting={1} go={go} />}>
      <DesignQuestion go={go} answer={DESIGN_ANSWER} /><Reports /><ChangeProposal go={go} />
    </Session>;
    case "change-decided": return <Session go={go} badge={{ active: true }} strip={<RunStrip stops={route("review")} status="Review, round 2" go={go} />}>
      <Reports /><ChangeProposal go={go} decided /><ReviewReports />
    </Session>;
    case "review": return <><Session go={go} badge={{ active: true }} strip={<RunStrip stops={route("review")} status="Review, round 2" go={go} />}>
      <Reports /><ChangeProposal go={go} decided /><ReviewReports /></Session><RunSheet go={go} at="review" /></>;
    case "stuck": return <Session go={go} strip={<RunStrip stops={route("stuck")} status="Review did not pass, waiting for you" waiting={1} go={go} />}>
      <ChangeProposal go={go} decided /><ReviewReports />
      <EventLine tone="negative" subject="review" phrase="round 2: 1 must-fix left" time="14:41" />
      <Card icon={<TriangleAlertIcon aria-hidden />} title="Review did not pass after 2 rounds" tone="warn"
        actions={[{ label: "Stop workflow", onPress: () => go("stuck"), tone: "danger" }, { label: "Fix it myself", onPress: () => go("stuck") }, { label: "Run round 3", onPress: () => go("review"), tone: "primary" }]}
        note="Stopping keeps all three branches. Nothing lands.">
        <Consequence tone="warn" icon={<TriangleAlertIcon aria-hidden />}><p><strong>Must fix:</strong> the CSV writer quotes commas but not line breaks, so a model name with a line break splits its row. <code>build</code>, <code>src/server/sessions/childRunsCsv.ts</code></p></Consequence>
      </Card>
    </Session>;
    case "ready": return <Session go={go} strip={<RunStrip stops={route("ready")} status="Finished, waiting for you to land" waiting={1} go={go} />}>
      <ReviewReports />
      <EventLine tone="positive" subject="review" phrase="passed in round 2" time="14:44" quoteFace="text" quote="No must-fix findings. One note left as is." />
      <Agent><p>The workflow finished. Every branch matches the contract, and the review passed.</p>
        <Card icon={<CheckIcon aria-hidden />} title="Design, build, review finished"
          actions={[{ label: "Review changes", onPress: () => go("ready") }, { label: "Land all on main", onPress: () => go("landed"), tone: "primary" }]}
          note="Lands in order: build, design, docs. Each branch rebases onto main first.">
          <dl className="wf-facts">
            <div><dt>Time</dt><dd>42 min</dd></div>
            <div><dt>Cost</dt><dd>$2.64</dd></div>
            <div><dt>Review</dt><dd>passed in round 2</dd></div>
          </dl>
          <ul className="wf-branches">
            <li><GitBranchIcon aria-hidden /><code>feat/run-export-api</code><span>5 commits</span></li>
            <li><GitBranchIcon aria-hidden /><code>design/run-export</code><span>5 commits</span></li>
            <li><GitBranchIcon aria-hidden /><code>docs/run-export-route</code><span>1 commit</span></li>
          </ul>
        </Card>
      </Agent>
    </Session>;
    case "landed": return <Session go={go}>
      <EventLine tone="positive" subject="you" phrase="landed 3 branches on main" time="14:47" quoteFace="text" quote="11 commits. The three worktrees are removed." />
      <Agent><p>Landed. This run differed from the saved workflow in two ways. Both helped, so I suggest you keep them.</p>
        <Card icon={<WorkflowIcon aria-hidden />} title="Save to Design, build, review?" meta="Version 4"
          actions={[{ label: "Compare runs", onPress: () => go("history") }, { label: "Keep version 3", onPress: () => go("landed") }, { label: "Save version 4", onPress: () => go("history"), tone: "primary" }]}>
          <label className="wf-change"><input type="checkbox" defaultChecked /><span><strong><code>build</code> uses GPT-6.1 Mini</strong><small>Build took 11 min and cost $0.31. The last 3 runs averaged 14 min and $1.10.</small></span></label>
          <label className="wf-change"><input type="checkbox" defaultChecked /><span><strong>A docs stage before review, when a run adds a route</strong><small>The agent added it in this run. The saved text does not mention docs.</small></span></label>
        </Card>
      </Agent>
    </Session>;
    case "history": return <><Session go={go}><Agent><p>Saved as version 4.</p></Agent></Session><HistorySheet go={go} /></>;
    default: return <Session go={go}><Before /><Offer go={go} /></Session>;
  }
}

/* ------------------------------------------------------------------ */
/* Review aids: the flow bar and the storyboard.                       */
/* ------------------------------------------------------------------ */

const ORDER = Object.keys(states);
const infoOf = (state: string): StateInfo => states[state === "change-decided" ? "review" : state] ?? states["suggest"]!;

function FlowBar({ state, go }: { state: string; go: Go }) {
  const bar = useRef<HTMLElement>(null);
  const index = Math.max(0, ORDER.indexOf(state === "change-decided" ? "review" : state));
  // Raise the bar above any open sheet: a popover shown after the dialog sits on top of it.
  useEffect(() => {
    const node = bar.current;
    if (!node || typeof node.showPopover !== "function") return;
    const timer = setTimeout(() => { if (node.matches(":popover-open")) node.hidePopover(); node.showPopover(); }, 60);
    return () => clearTimeout(timer);
  }, [state]);
  const info = infoOf(state);
  return <nav ref={bar} className="mock-flow" popover="manual" aria-label="Mockup flow">
    <button type="button" disabled={index === 0} onClick={() => go(ORDER[index - 1]!)} aria-label="Previous screen">‹</button>
    <span><strong>{info.letter}</strong> {info.label}</span>
    <button type="button" disabled={index === ORDER.length - 1} onClick={() => go(ORDER[index + 1]!)} aria-label="Next screen">›</button>
  </nav>;
}

function Mockup({ initial, nav }: { initial: string; nav: boolean }) {
  const [state, setState] = useState(initial);
  const go: Go = (next) => {
    setState(next);
    const url = new URL(location.href);
    url.searchParams.set("state", next);
    history.replaceState(null, "", url);
  };
  return <div className="mock-page" data-nav={nav || undefined}>
    {nav && <FlowBar state={state} go={go} />}
    <div className="mock-app" key={state}><Screen state={state} go={go} /></div>
  </div>;
}

function Storyboard({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const frame = { inlineSize: `${String(Math.round(width * zoom))}px`, blockSize: `${String(Math.round(height * zoom))}px` };
  return <div className="mock-board">
    <header className="mock-board-head">
      <h1>Design, build, review: from offer to landing</h1>
      <p>Each frame is one screen at {width} × {height} CSS pixels. The main path runs A to N. A frame marked branch is another way in or another outcome. Open a frame to tap through the flow from there.</p>
    </header>
    <div className="mock-board-grid" style={{ gridTemplateColumns: `repeat(auto-fill, ${frame.inlineSize})` }}>
      {ORDER.map((key) => {
        const info = states[key]!;
        return <figure key={key} className="mock-frame" data-branch={info.branch || undefined}>
          <a href={`?state=${key}&nav=1`} className="mock-frame-link" aria-label={`Open ${info.label}`}>
            <span className="mock-device" style={frame}>
              <iframe title={info.label} src={`?state=${key}`} width={width} height={height} style={{ transform: `scale(${String(zoom)})` }} tabIndex={-1} />
            </span>
          </a>
          <figcaption>
            <span className="mock-frame-title"><span className="mock-frame-letter">{info.letter}</span><strong>{info.label}</strong></span>
            {info.from && <span className="mock-frame-from">{info.branch ? "Branch, " : ""}from {info.from}</span>}
            <span>{info.note}</span>
          </figcaption>
        </figure>;
      })}
    </div>
  </div>;
}

const params = new URLSearchParams(location.search);
const key = params.get("state") ?? "all";
const [width = 704, height = 783] = (params.get("size") ?? "704x783").split("x").map(Number);
const zoom = Number(params.get("zoom") ?? "0.5");
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
if (key === "all") document.documentElement.classList.add("mock-board-page");
createRoot(root).render(key === "all" ? <Storyboard width={width} height={height} zoom={zoom} />
  : <Mockup initial={key in states || key === "change-decided" ? key : "suggest"} nav={params.get("nav") === "1"} />);
