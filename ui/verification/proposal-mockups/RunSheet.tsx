// Mockup only. The run mode of the document-first sheet. The layout is the
// proposal's: the rail is the route, now live; the left pane shows what the
// rail selects. With nothing selected it is the plan, marked where the run
// stands, with a waiting stop's card on top. With a worker selected it is
// that worker's live record and a box to steer it, as the child agents panel
// shows it today. In one column the route comes first, and a worker opens
// over it with a way back.
import { Fragment, useEffect, useState } from "react";
import { MarkdownFragment } from "../../src/ui/MarkdownFragment";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { WorkflowEntryView } from "../../src/workflows/WorkflowEntryView";
import { ExchangeLog, type ExchangeLine } from "../../src/ui/ExchangeLog";
import { ReplyBox } from "../../src/ui/ReplyBox";
import { Sheet, SheetHead } from "./mockupParts";
import { PlanBody, type StageProgress } from "./ProposalSheet";
import { WorkerModel } from "./RouteEditor";
import { modelName } from "./routeEdits";
import type { LiveRun, LiveStage, LiveWorker } from "./liveRun";

/** A stop's block: hollow until reached, solid live while it waits on the reader, ink once passed. */
const stopState = (progress: StageProgress) => progress === "waiting" ? "waiting" : progress === "done" ? "done" : "next";

function Blocks({ runs }: { runs: readonly LiveWorker["runs"][number][] }) {
  const done = runs.filter((state) => state === "done").length;
  return <span className="pm-blocks" role="img" aria-label={`${String(runs.length)} ${runs.length === 1 ? "run" : "runs"}, ${String(done)} done`}>
    {runs.map((state, index) => <span key={index} className="pm-block" data-s={state} />)}
  </span>;
}

/** The route, live. A stage opens its part of the plan; a worker opens its record. */
function LiveRoute({ run, selected, models, onStage, onWorker }: {
  run: LiveRun; selected: string | undefined; models: Readonly<Record<string, string | undefined>>;
  onStage: (id: string) => void; onWorker: (key: string) => void;
}) {
  const done = run.stages.filter((stage) => stage.progress === "done").length;
  // The stage at work and a stop that waits list their workers. Other stages fold them into their blocks until opened.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const expanded = (live: LiveStage) => live.progress === "current" || live.progress === "waiting" || opened.has(live.id) || selected?.startsWith(`${live.id}/`) === true;
  return <>
    <div className="pm-route-head">
      <h3 className="pm-section-label">Route</h3>
      <span className="pm-route-meta">{done} of {run.stages.length} done</span>
    </div>
    <ol className="pm-route pm-live" role="list">
      {run.stages.map((live, index) => {
        const stage = run.proposal.stages.find((candidate) => candidate.id === live.id);
        if (stage === undefined) return null;
        const open = expanded(live);
        const status = live.status ?? (live.workers.length === 0 ? stage.does : undefined);
        return <li key={live.id} className="pm-route-item" data-progress={live.progress}
>
          <div className="pm-route-row">
            <button type="button" className="pm-route-stage" aria-expanded={live.workers.length === 0 ? undefined : open} onClick={() => {
              if (live.workers.length > 0 && live.progress !== "current" && live.progress !== "waiting") setOpened((current) => {
                const next = new Set(current); if (next.has(live.id)) next.delete(live.id); else next.add(live.id); return next;
              });
              onStage(live.id);
            }}>
              <span className="pm-route-num">{live.progress === "done" ? <CheckIcon aria-label="Done" /> : index + 1}</span>
              <span className="pm-route-text">
                <span className="pm-route-name">{stage.name}</span>
                {status !== undefined && <span className="pm-route-who"><MarkdownFragment inline text={status} /></span>}
              </span>
              <span className="pm-marks">
                {!open && live.workers.length > 0 && <Blocks runs={live.workers.flatMap((worker) => worker.runs)} />}
                {stage.stop !== undefined && <span className="pm-blocks"><span className="pm-block" data-s={stopState(live.progress)} data-stop
                  title={stage.stop === "land" ? "You land" : "You approve"} /></span>}
              </span>
            </button>
          </div>
          {open && live.workers.length > 0 && <ul className="pm-worker-list" role="list">
            {live.workers.map((worker) => {
              const model = models[worker.name];
              const key = `${live.id}/${worker.name}`;
              return <li key={key}>
                <button type="button" className="pm-live-worker" aria-current={selected === key || undefined} onClick={() => onWorker(key)}>
                  <Blocks runs={worker.runs} />
                  <span className="pm-live-worker-text">
                    <span className="pm-worker-who"><code>{worker.name}</code> {worker.agent ?? "general helper"}</span>
                    <span className="pm-live-worker-status">{worker.status}</span>
                    {(model !== undefined || model !== worker.model) && <span className="pm-live-worker-model" data-edited={model !== worker.model || undefined}>
                      {model === undefined ? "Session's model" : modelName(model)}</span>}
                  </span>
                </button>
              </li>;
            })}
          </ul>}
        </li>;
      })}
    </ol>
  </>;
}

/** The record of one worker, its model, and a box to steer it. */
function WorkerPane({ worker, model, onModel, onBack }: {
  worker: LiveWorker; model: string | undefined; onModel: (model: string | undefined) => void; onBack: () => void;
}) {
  const [sent, setSent] = useState<ExchangeLine[]>([]);
  const changed = model !== worker.model;
  const started = worker.runs.some((state) => state !== "next");
  const hint = !changed ? undefined
    : worker.busy ? `From its next turn. The turn in progress finishes on ${modelName(worker.model)}.`
    : started ? "From its next run, such as another review round." : "It starts on this model.";
  const lines = [...worker.lines, ...sent].map((line) => line.kind === "block" && typeof line.content === "string"
    ? { ...line, content: <p className="pm-round"><span>{line.content}</span></p> } : line);
  return <div className="pm-worker-pane">
    <header className="pm-pane-head">
      <button type="button" className="pm-text-button pm-back" onClick={onBack}>
        <ArrowLeftIcon aria-hidden /><span className="pm-back-wide">Plan</span><span className="pm-back-narrow">Route</span></button>
      <div className="pm-pane-titles">
        <h3 className="pm-pane-title"><Blocks runs={worker.runs} /><code>{worker.name}</code><span>{worker.agent ?? "general helper"}</span></h3>
        <p className="pm-pane-status">{worker.status}</p>
      </div>
      {worker.busy && <button type="button" className="pm-text-button" data-tone="danger">Stop</button>}
    </header>
    <div className="pm-pane-model">
      <span className="pm-field-label">Model</span>
      <WorkerModel worker={{ name: worker.name, ...(model === undefined ? {} : { model }) }} proposed={worker.model} disabled={false} onChange={onModel} />
      {hint !== undefined && <span className="pm-field-hint">{hint}</span>}
    </div>
    <div className="pm-pane-log">
      <ExchangeLog lines={lines} follow={worker.busy} empty={started ? "No messages yet." : "This worker has not started. Its record shows here when it does."} />
    </div>
    {started && <div className="pm-pane-reply">
      <ReplyBox label={`Message ${worker.name}`} sendLabel={`Send to ${worker.name}`}
        placeholder={worker.busy ? `Steer ${worker.name} while it works` : `Ask ${worker.name} a follow-up`}
        onSend={async (text) => setSent((current) => [...current, { kind: "in", key: `sent-${String(current.length)}`, label: "From you", text }])} />
    </div>}
  </div>;
}

export function RunSheet({ run, select, at, models: initialModels }: {
  run: LiveRun;
  /** The worker shown in the left pane, as "stage/name". Without one, the plan. */
  select?: string;
  /** Start with the plan scrolled to this stage. */
  at?: string;
  /** Model changes the reader already made. */
  models?: Readonly<Record<string, string>>;
}) {
  // A worker can run in more than one stage, such as a builder that fixes review findings; each stage's runs are their own entry.
  const keyed = run.stages.flatMap((stage) => stage.workers.map((worker) => ({ key: `${stage.id}/${worker.name}`, worker })));
  const workers = keyed.map(({ worker }) => worker);
  const [selected, setSelected] = useState(select);
  const [models, setModels] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(workers.map((worker) => [worker.name, initialModels?.[worker.name] ?? worker.model])));
  const [target, setTarget] = useState(at);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const worker = keyed.find((candidate) => candidate.key === selected)?.worker;
  const progress = Object.fromEntries(run.stages.map((stage: LiveStage) => [stage.id, stage.progress]));

  // A stage opens the plan at its section, once the plan is in the pane.
  useEffect(() => {
    if (target === undefined || worker !== undefined || frame === null) return undefined;
    const timer = setTimeout(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      frame.querySelector(`[data-stage="${target}"]`)?.scrollIntoView({ block: "start", behavior: at === target || reduce ? "auto" : "smooth" });
      setTarget(undefined);
    }, 60);
    return () => clearTimeout(timer);
  }, [target, worker, frame, at]);

  // A waiting stop leads the plan beside the route; in one column it leads the route itself.
  // The chat's own decision card, so the sheet and the chat show one choice in one style.
  const stopCard = (place: string) => run.stop === undefined || worker !== undefined ? null : <section className={`pm-stop ${place}`}>
    <WorkflowEntryView entry={run.stop.entry} run={run.stop.run} onDecide={async () => true} />
  </section>;

  return <Sheet label={run.proposal.title}>
    <div ref={setFrame} className="pm-a pm-run" data-view={worker === undefined ? "plan" : "worker"}>
      <SheetHead title={run.proposal.title} name={run.proposal.name} stages={run.stages.length} subtitle={run.status} closeLabel="Close the run" />
      <div className="pm-body">
        {stopCard("pm-stop-narrow")}
        <article className="pm-doc" aria-label={worker === undefined ? "Plan" : `${worker.name}'s record`}>
          {worker === undefined
            ? <div className="pm-measure">
              {stopCard("pm-stop-wide")}
              <PlanBody proposal={run.proposal} progress={progress} />
            </div>
            : <WorkerPane key={selected} worker={worker} model={models[worker.name]} onBack={() => setSelected(undefined)}
              onModel={(model) => setModels((current) => ({ ...current, [worker.name]: model }))} />}
        </article>
        <aside className="pm-rail" aria-label="The run">
          <section className="pm-rail-section">
            <LiveRoute run={run} selected={selected} models={models} onWorker={setSelected}
              onStage={(id) => { setSelected(undefined); setTarget(id); }} />
          </section>
          <section className="pm-rail-section">
            <h3 className="pm-section-label">Inputs</h3>
            <dl className="pm-run-inputs">{run.inputs.map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value === "" ? "Empty" : value}</dd></Fragment>)}</dl>
          </section>
        </aside>
      </div>
      <footer className="pm-foot pm-run-foot">
        <p className="pm-note">{run.note}</p>
        <div className="pm-actions"><button type="button" className="pm-button" data-tone="danger">Stop the run</button></div>
      </footer>
    </div>
  </Sheet>;
}
