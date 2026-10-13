// Mockup only. Candidate A, "document first": the plan is a page you read.
// Beside it, a rail holds the route, the inputs, and the decision. In one
// column the plan comes first, the route follows it, and the inputs fold
// into one line above the buttons. One DOM; the container queries in
// proposalMockups.css choose the layout from the sheet's size.
import { Fragment, useEffect, useRef, useState } from "react";
import { Undo2Icon } from "lucide-react";
import type { WorkflowStage } from "../workflowsModel";
import { AlertCard } from "../../ui/AlertCard";
import { Lede } from "../../ui/Lede";
import { MarkdownFragment } from "../../ui/MarkdownFragment";
import { PlanMarkdown } from "./PlanMarkdown";
import { SETTINGS_PORT, type InputValues, type MockProposal } from "./planDocument";
import { Actions, ChangesBox, Decided, InputFields, InputSummary, Sheet, SheetHead, type Outcome } from "./mockupParts";
import { RouteEditor } from "./RouteEditor";
import { changeLine, reshapes, routeChanges, undoChange, type RouteChange } from "./routeEdits";

export interface ProposalSheetProps {
  proposal?: MockProposal;
  /** The record: still on its way, failed to arrive, or here. Until it arrives the sheet shows what the chat card knows. */
  read?: "reading" | "failed" | "ready";
  /** Why the workflow cannot start now. */
  blocked?: string;
  /** Start was pressed and the server has not answered. */
  starting?: boolean;
  /** Why the last action failed. */
  error?: string;
  changing?: boolean;
  outcome?: Outcome;
  /** Inputs the reader already edited. */
  edits?: InputValues;
  /** Open the folded inputs in one column. */
  inputsOpen?: boolean;
  /** Start scrolled to this stage's section. */
  at?: string;
  /** Route edits the reader already made. */
  route?: (stages: readonly WorkflowStage[]) => WorkflowStage[];
  /** Start with the route in edit mode. */
  editing?: boolean;
}

const READ_FAILED = "The server did not answer in time.";

/**
 * The plan: its overview, then one section per heading. A stage's section carries the stage's number in the
 * reader's route. A stage the reader removed stays, struck; a stage they added has a section the agent will write.
 */
function PlanBody({ proposal, stages = proposal.stages, changes = [] }: { proposal: MockProposal; stages?: readonly WorkflowStage[]; changes?: readonly RouteChange[] }) {
  const numberOf = (id: string | undefined) => { const at = id === undefined ? -1 : stages.findIndex((stage) => stage.id === id); return at < 0 ? undefined : at + 1; };
  const added = stages.filter((stage) => !proposal.stages.some((s) => s.id === stage.id));
  // A new stage's section follows the section of the stage before it in the reader's route.
  const addedAfter = (id: string | undefined) => added.filter((stage) => stages[stages.indexOf(stage) - 1]?.id === id);
  const chainAfter = (id: string | undefined): WorkflowStage[] => addedAfter(id).flatMap((stage) => [stage, ...chainAfter(stage.id)]);
  const placeholder = (stage: WorkflowStage) => <section key={`new-${stage.id}`} data-stage={stage.id} data-number={numberOf(stage.id)} data-new className="pm-sec"
    style={{ "--stage": numberOf(stage.id) ?? 0 }}>
    <div className="markdown pm-sec-head"><h2>{stage.name}<span className="pm-new">New</span></h2></div>
    <p className="pm-sec-pending">{stage.does === undefined ? "" : `${stage.does} `}The agent writes this section when it updates the plan.</p>
  </section>;
  const firstStageSection = proposal.sections.findIndex((section) => section.stage !== undefined);
  return <>
    {proposal.overview !== "" && <section className="pm-overview"><PlanMarkdown id="overview" text={proposal.overview} /></section>}
    {proposal.sections.map((s, index) => {
      const number = numberOf(s.stage);
      const removed = s.stage !== undefined && number === undefined;
      const workerLines = changes.filter((change) => change.stage === s.stage && (change.kind === "add-worker" || change.kind === "remove-worker"));
      return <Fragment key={index}>
        {index === firstStageSection && chainAfter(undefined).map(placeholder)}
        <section data-stage={removed ? undefined : s.stage} data-number={number} data-removed={removed || undefined} className="pm-sec"
          style={number === undefined ? undefined : { "--stage": number }}>
          <div className="markdown pm-sec-head"><h2><span className="pm-sec-title"><MarkdownFragment inline text={s.title} /></span>
            {removed && <span className="pm-removed">Removed</span>}</h2></div>
          {removed && <p className="pm-sec-flag">You removed this stage. The agent takes it out when it updates the plan.</p>}
          {workerLines.length > 0 && <p className="pm-sec-flag">{workerLines.map((change) => <span key={changeLine(change, stages)} className={change.kind === "add-worker" ? "pm-new" : "pm-removed"}>
            {change.kind === "add-worker" ? "+" : "−"} {"worker" in change ? change.worker : ""}</span>)}The agent updates this section to match.</p>}
          <div className="pm-sec-body"><PlanMarkdown id={`section-${String(index)}`} text={s.body} /></div>
        </section>
        {s.stage !== undefined && chainAfter(s.stage).map(placeholder)}
      </Fragment>;
    })}
    {firstStageSection < 0 && chainAfter(undefined).map(placeholder)}
  </>;
}

/** The route changes, above the plan, while the plan does not match them. */
function PlanOutOfDate({ changes, stages, onUndo, onUndoAll }: { changes: readonly RouteChange[]; stages: readonly WorkflowStage[]; onUndo: (change: RouteChange) => void; onUndoAll: () => void }) {
  return <section className="pm-stale" aria-label="Route changes">
    <div className="pm-stale-head">
      <p className="pm-stale-title">The plan does not match your route yet</p>
      <button type="button" className="pm-text-button" onClick={onUndoAll}>Undo all</button>
    </div>
    <ul className="pm-stale-list" role="list">
      {changes.map((change) => <li key={changeLine(change, stages)}>
        <span className="pm-stale-line"><MarkdownFragment inline text={changeLine(change, stages)} /></span>
        <button type="button" className="pm-icon-small" aria-label="Undo this change" title="Undo this change" onClick={() => onUndo(change)}><Undo2Icon aria-hidden /></button>
      </li>)}
    </ul>
    <p className="pm-note">Update the plan to send these to the agent. It rewrites the plan to match, and you start the new one.</p>
  </section>;
}

/** The plan alone, at its full length, as the sheet's left pane sets it. For comparing two plans. */
export function PlanPage({ proposal }: { proposal: MockProposal }) {
  return <div className="pm-page"><h1 className="pm-title">{proposal.title}</h1><article className="pm-doc"><div className="pm-measure"><PlanBody proposal={proposal} /></div></article></div>;
}

export function ProposalSheet({ proposal = SETTINGS_PORT, read: initialRead = "ready", blocked, starting = false, error, changing: initialChanging = false,
  outcome: initialOutcome, edits, inputsOpen = false, at, route: initialRoute, editing: initialEditing = false }: ProposalSheetProps) {
  const [read, setRead] = useState(initialRead);
  const [values, setValues] = useState<InputValues>({ ...proposal.proposed, ...edits });
  const [changing, setChanging] = useState(initialChanging);
  const [outcome, setOutcome] = useState(initialOutcome);
  const [open, setOpen] = useState(inputsOpen);
  const [current, setCurrent] = useState<string>();
  const frame = useRef<HTMLDivElement>(null);
  const { sections, inputs } = proposal;
  const [stages, setStages] = useState<WorkflowStage[]>(() => initialRoute?.(proposal.stages) ?? [...proposal.stages]);
  const [editing, setEditing] = useState(initialEditing);
  const changes = routeChanges(proposal.stages, stages);
  const stale = reshapes(changes).length > 0;
  const models = changes.length - reshapes(changes).length;
  const ready = read === "ready";
  const decided = outcome !== undefined;

  const section = (stage: string) => frame.current?.querySelector<HTMLElement>(`[data-stage="${stage}"]`) ?? undefined;
  const linked = [...sections.flatMap((s) => s.stage === undefined || !stages.some((stage) => stage.id === s.stage) ? [] : [s.stage]),
    ...stages.filter((stage) => !proposal.stages.some((s) => s.id === stage.id)).map((stage) => stage.id)];
  const jump = (id: string, smooth = true) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section(id)?.scrollIntoView({ block: "start", behavior: smooth && !reduce ? "smooth" : "auto" });
    setCurrent(id);
  };
  // The section in view: the last one whose heading passed the top 40% of the plan's scroller.
  const spy = (event: React.UIEvent) => {
    const box = event.target;
    const first = linked[0] === undefined ? undefined : section(linked[0]);
    if (!(box instanceof HTMLElement) || first === undefined || !box.contains(first)) return;
    const line = box.getBoundingClientRect().top + box.clientHeight * 0.4;
    setCurrent(linked.filter((id) => (section(id)?.getBoundingClientRect().top ?? Infinity) <= line).at(-1));
  };
  useEffect(() => { if (at !== undefined) { const timer = setTimeout(() => jump(at, false), 60); return () => clearTimeout(timer); } return undefined; }, []);

  const busy = starting;
  const failure = error;
  const routeNote = stale ? "You changed the route. Update the plan, then start the new one."
    : models > 0 ? `${String(models)} ${models === 1 ? "model" : "models"} changed. The run uses ${models === 1 ? "it" : "them"}; the plan stays as it is.` : undefined;
  const note = failure !== undefined ? <span role="alert" className="pm-note-bad">{failure}</span>
    : starting ? "Starting…"
    : read === "reading" ? "Reading the proposal…"
    : read === "failed" ? "Read the proposal again to start it."
    : blocked ?? (changing ? stale ? "The agent rewrites the plan to match your route, then proposes it again." : "The agent reads your note and proposes again."
      : routeNote ?? "It runs in this chat. Nothing is saved to the repository.");
  const lines = changes.map((change) => changeLine(change, stages));
  const decide = decided ? <Decided outcome={outcome} />
    : changing ? <><p className="pm-note">{note}</p><ChangesBox busy={busy} changes={stale ? lines : undefined} onBack={() => setChanging(false)}
      onSend={(text) => setOutcome({ kind: "changes", note: [...(stale ? lines : []), text].filter((line) => line !== "").join("\n") })} /></>
    : <><p className="pm-note" data-blocked={(blocked !== undefined || stale) && failure === undefined && !starting && ready || undefined}>{note}</p>
      <Actions startLabel={starting ? "Starting…" : "Start workflow"} canStart={ready && blocked === undefined && !stale} busy={busy} update={stale}
        onStart={() => setOutcome({ kind: "started" })} onChanges={() => setChanging(true)} onDismiss={() => setOutcome({ kind: "dismissed" })} /></>;

  return <Sheet label={proposal.title}>
    <div ref={frame} className="pm-a" onScrollCapture={spy}>
      <SheetHead title={proposal.title} name={proposal.name} stages={stages.length} />
      <div className="pm-body">
        <article className="pm-doc" aria-label="Plan" aria-busy={read === "reading" || undefined}>
          <div className="pm-measure">
            {read === "ready" && stale && !decided && <PlanOutOfDate changes={changes} stages={stages} onUndoAll={() => setStages([...proposal.stages])}
              onUndo={(change) => setStages(undoChange(proposal.stages, stages, change))} />}
            {read === "ready" && <PlanBody proposal={proposal} stages={stages} changes={changes} />}
            {read === "reading" && <div className="pm-reading">
              <Lede>{proposal.summary}</Lede>
              <div className="pm-skeleton" aria-hidden><span /><span /><span /><span /><span /></div>
              <p className="pm-note">Reading the plan…</p>
            </div>}
            {read === "failed" && <div className="pm-reading">
              <Lede>{proposal.summary}</Lede>
              <AlertCard label="The plan could not be read" title="The plan could not be read" actions={[{ label: "Retry", onPress: () => setRead("ready") }]}>{READ_FAILED}</AlertCard>
            </div>}
          </div>
        </article>
        <aside className="pm-rail" aria-label="Before you start">
          {(stages.length > 0 || proposal.stages.length > 0) && <section className="pm-rail-section">
            <RouteEditor original={proposal.stages} stages={stages} onChange={setStages} editing={editing && !decided} onEditing={setEditing}
              disabled={!ready || decided || busy} current={current} onJump={ready && linked.length > 0 ? jump : undefined} />
          </section>}
          {inputs.length > 0 && <section className="pm-rail-section pm-rail-inputs">
            <h3 className="pm-section-label">Inputs</h3>
            {ready ? <InputFields inputs={inputs} values={values} proposed={proposal.proposed} onChange={setValues} disabled={decided || busy} />
              : <p className="pm-note">The inputs arrive with the plan.</p>}
          </section>}
        </aside>
      </div>
      <footer className="pm-foot" data-open={open || undefined} data-decided={decided || undefined}>
        {ready && !decided && !changing && inputs.length > 0 && <div className="pm-foot-inputs">
          <InputSummary inputs={inputs} values={values} proposed={proposal.proposed} open={open} onToggle={() => setOpen(!open)} />
          {open && <InputFields inputs={inputs} values={values} proposed={proposal.proposed} onChange={setValues} disabled={busy} compact />}
        </div>}
        <div className="pm-decide">{decide}</div>
      </footer>
    </div>
  </Sheet>;
}
