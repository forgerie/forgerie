// Mockup only. Three layouts for the same proposal. Each is one DOM; the
// container queries in proposalMockups.css decide between two panes and one
// column from the sheet's own size, never the device's.
import { useRef, useState } from "react";
import { PlanMarkdown } from "./PlanMarkdown";
import { PLAN_OVERVIEW, PLAN_SECTIONS } from "./planDocument";
import { Actions, InputFields, InputSummary, NOTE, Sheet, SheetHead, STAGES, StageMarks, useInputs, WorkerChips } from "./mockupParts";

/** The plan without its title: the sheet's header already shows it. */
const DOCUMENT = [PLAN_OVERVIEW, ...PLAN_SECTIONS.map((section) => `## ${section.title}\n\n${section.body}`)].join("\n\n");
const stageOf = (id: string) => STAGES.find((stage) => stage.id === id);

/** A: the plan is a page you read. The route and the inputs sit in a rail beside it, with Start at the rail's foot. */
export function DocumentFirst() {
  const [values, setValues] = useInputs();
  return <Sheet variant="a">
    <SheetHead />
    <div className="pm-a-body">
      <article className="pm-a-doc" aria-label="Plan"><div className="pm-measure"><PlanMarkdown text={DOCUMENT} /></div></article>
      <aside className="pm-a-rail" aria-label="Before you start">
        <section className="pm-rail-section">
          <h3 className="pm-section-label">Route</h3>
          <ol className="pm-route" role="list">
            {STAGES.map((stage, index) => <li key={stage.id} className="pm-route-stage">
              <span className="pm-route-num">{index + 1}</span><span className="pm-route-name">{stage.name}</span><StageMarks stage={stage} />
            </li>)}
          </ol>
        </section>
        <section className="pm-rail-section">
          <h3 className="pm-section-label">Inputs</h3>
          <InputFields values={values} onChange={setValues} />
        </section>
      </aside>
    </div>
    <footer className="pm-foot pm-a-foot"><p className="pm-note">{NOTE}</p><Actions layout="rail" /></footer>
  </Sheet>;
}

/** B: the stages are the spine. The plan is one document cut at its stages; the spine says where you are and jumps. */
export function RouteSpine() {
  const [values, setValues] = useInputs();
  const doc = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState("overview");
  const ids = ["overview", ...PLAN_SECTIONS.map((section) => section.id), "inputs"];
  const jump = (id: string) => { doc.current?.querySelector(`#pm-b-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); setAt(id); };
  const onScroll = () => {
    const box = doc.current; if (!box) return;
    const top = box.getBoundingClientRect().top + 24;
    const seen = ids.filter((id) => (box.querySelector(`#pm-b-${id}`)?.getBoundingClientRect().top ?? Infinity) <= top + 40);
    setAt(seen.at(-1) ?? "overview");
  };
  return <Sheet variant="b">
    <SheetHead />
    <div className="pm-b-body" ref={doc} onScroll={onScroll}>
      <nav className="pm-b-spine" aria-label="Plan sections">
        <ol role="list">
          <li><button type="button" className="pm-spine-item" aria-current={at === "overview" || undefined} onClick={() => jump("overview")}>
            <span className="pm-route-num" aria-hidden /><span className="pm-route-name">Overview</span></button></li>
          {STAGES.map((stage, index) => <li key={stage.id}><button type="button" className="pm-spine-item" aria-current={at === stage.id || undefined} onClick={() => jump(stage.id)}>
            <span className="pm-route-num">{index + 1}</span><span className="pm-route-name">{stage.name}</span><StageMarks stage={stage} /></button></li>)}
          <li><button type="button" className="pm-spine-item" aria-current={at === "inputs" || undefined} onClick={() => jump("inputs")}>
            <span className="pm-route-num" aria-hidden /><span className="pm-route-name">Inputs</span><span className="pm-spine-meta"><code>{values.base}</code>, {values.rounds} rounds</span></button></li>
        </ol>
      </nav>
      <div className="pm-b-doc">
        <section id="pm-b-overview" className="pm-b-section"><div className="pm-measure"><PlanMarkdown id="overview" text={PLAN_OVERVIEW} /></div></section>
        {PLAN_SECTIONS.map((section, index) => {
          const stage = stageOf(section.id);
          return <section key={section.id} id={`pm-b-${section.id}`} className="pm-b-section" aria-labelledby={`pm-b-${section.id}-title`}>
            <div className="pm-measure">
              <header className="pm-stage-head">
                <span className="pm-stage-num">{index + 1}</span>
                <h3 id={`pm-b-${section.id}-title`} className="pm-stage-title">{section.title}</h3>
              </header>
              {stage && <WorkerChips stage={stage} />}
              <PlanMarkdown id={section.id} text={section.body} />
            </div>
          </section>;
        })}
        <section id="pm-b-inputs" className="pm-b-section" aria-labelledby="pm-b-inputs-title">
          <div className="pm-measure">
            <header className="pm-stage-head"><h3 id="pm-b-inputs-title" className="pm-stage-title">Inputs</h3></header>
            <InputFields values={values} onChange={setValues} />
          </div>
        </section>
      </div>
    </div>
    <footer className="pm-foot pm-b-foot"><p className="pm-note">{NOTE}</p><Actions /></footer>
  </Sheet>;
}

/** C: the plan is a board of cards, one per stage. The inputs and the decision share one launch bar along the bottom. */
export function CardDeck({ inputsOpen = false }: { inputsOpen?: boolean }) {
  const [values, setValues] = useInputs();
  const [open, setOpen] = useState(inputsOpen);
  return <Sheet variant="c">
    <SheetHead />
    <div className="pm-c-board">
      <article className="pm-card pm-card-overview" aria-label="Overview"><PlanMarkdown id="overview" text={PLAN_OVERVIEW} /></article>
      {PLAN_SECTIONS.map((section, index) => {
        const stage = stageOf(section.id);
        return <article key={section.id} className="pm-card" aria-labelledby={`pm-c-${section.id}`}>
          <header className="pm-card-head">
            <span className="pm-stage-num">{index + 1}</span>
            <h3 id={`pm-c-${section.id}`} className="pm-stage-title">{section.title}</h3>
          </header>
          {stage && <WorkerChips stage={stage} />}
          <PlanMarkdown id={section.id} text={section.body} />
        </article>;
      })}
    </div>
    <footer className="pm-foot pm-c-launch" data-open={open || undefined}>
      <div className="pm-c-inputs-inline"><InputFields values={values} onChange={setValues} layout="bar" /></div>
      <div className="pm-c-inputs-folded">
        <InputSummary values={values} open={open} onToggle={() => setOpen(!open)} />
        {open && <InputFields values={values} onChange={setValues} layout="bar" />}
      </div>
      <div className="pm-c-decide"><p className="pm-note">{NOTE}</p><Actions /></div>
    </footer>
  </Sheet>;
}
