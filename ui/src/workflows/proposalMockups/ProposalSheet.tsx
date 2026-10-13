// Mockup only. Candidate A, "document first": the plan is a page you read.
// Beside it, a rail holds the route, the inputs, and the decision. In one
// column the plan comes first, the route follows it, and the inputs fold
// into one line above the buttons. One DOM; the container queries in
// proposalMockups.css choose the layout from the sheet's size.
import { useEffect, useRef, useState } from "react";
import { AlertCard } from "../../ui/AlertCard";
import { Lede } from "../../ui/Lede";
import { PlanMarkdown } from "./PlanMarkdown";
import { SETTINGS_PORT, type InputValues, type MockProposal } from "./planDocument";
import { Actions, ChangesBox, Decided, InputFields, InputSummary, Route, Sheet, SheetHead, type Outcome } from "./mockupParts";

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
}

const READ_FAILED = "The server did not answer in time.";

/** The plan: its overview, then one section per heading. A stage's section carries the stage's number. */
function PlanBody({ proposal }: { proposal: MockProposal }) {
  return <>
    {proposal.overview !== "" && <section className="pm-overview"><PlanMarkdown id="overview" text={proposal.overview} /></section>}
    {proposal.sections.map((s, index) => {
      const number = s.stage === undefined ? undefined : proposal.stages.findIndex((stage) => stage.id === s.stage) + 1;
      return <section key={index} data-stage={s.stage} data-number={number} className="pm-sec" style={number === undefined ? undefined : { "--stage": number }}>
        <PlanMarkdown id={`section-${String(index)}`} text={`## ${s.title}\n\n${s.body}`} />
      </section>;
    })}
  </>;
}

/** The plan alone, at its full length, as the sheet's left pane sets it. For comparing two plans. */
export function PlanPage({ proposal }: { proposal: MockProposal }) {
  return <div className="pm-page"><h1 className="pm-title">{proposal.title}</h1><article className="pm-doc"><div className="pm-measure"><PlanBody proposal={proposal} /></div></article></div>;
}

export function ProposalSheet({ proposal = SETTINGS_PORT, read: initialRead = "ready", blocked, starting = false, error, changing: initialChanging = false,
  outcome: initialOutcome, edits, inputsOpen = false, at }: ProposalSheetProps) {
  const [read, setRead] = useState(initialRead);
  const [values, setValues] = useState<InputValues>({ ...proposal.proposed, ...edits });
  const [changing, setChanging] = useState(initialChanging);
  const [outcome, setOutcome] = useState(initialOutcome);
  const [open, setOpen] = useState(inputsOpen);
  const [current, setCurrent] = useState<string>();
  const frame = useRef<HTMLDivElement>(null);
  const { stages, sections, inputs } = proposal;
  const ready = read === "ready";
  const decided = outcome !== undefined;

  const section = (stage: string) => frame.current?.querySelector<HTMLElement>(`[data-stage="${stage}"]`) ?? undefined;
  const linked = sections.flatMap((s) => s.stage === undefined ? [] : [s.stage]);
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
  const note = failure !== undefined ? <span role="alert" className="pm-note-bad">{failure}</span>
    : starting ? "Starting…"
    : read === "reading" ? "Reading the proposal…"
    : read === "failed" ? "Read the proposal again to start it."
    : blocked ?? (changing ? "The agent reads your note and proposes again." : "It runs in this chat. Nothing is saved to the repository.");
  const decide = decided ? <Decided outcome={outcome} />
    : changing ? <><p className="pm-note">{note}</p><ChangesBox busy={busy} onBack={() => setChanging(false)} onSend={(text) => setOutcome({ kind: "changes", note: text })} /></>
    : <><p className="pm-note" data-blocked={blocked !== undefined && failure === undefined && !starting && ready || undefined}>{note}</p>
      <Actions startLabel={starting ? "Starting…" : "Start workflow"} canStart={ready && blocked === undefined} busy={busy}
        onStart={() => setOutcome({ kind: "started" })} onChanges={() => setChanging(true)} onDismiss={() => setOutcome({ kind: "dismissed" })} /></>;

  return <Sheet label={proposal.title}>
    <div ref={frame} className="pm-a" onScrollCapture={spy}>
      <SheetHead title={proposal.title} name={proposal.name} stages={stages.length} />
      <div className="pm-body">
        <article className="pm-doc" aria-label="Plan" aria-busy={read === "reading" || undefined}>
          <div className="pm-measure">
            {read === "ready" && <PlanBody proposal={proposal} />}
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
          {stages.length > 0 && <section className="pm-rail-section">
            <h3 className="pm-section-label">Route</h3>
            <Route stages={stages} current={current} onJump={ready && linked.length > 0 ? jump : undefined} linked={linked} />
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
