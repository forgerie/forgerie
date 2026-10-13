// Mockup only. The pieces all three layouts share: the sheet, its header, the
// inputs, a stage's marks, and the decision buttons. Layout lives in each
// variant and in proposalMockups.css.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { PROPOSAL, PROPOSAL_STAGES } from "../fixtures/proposals";
import type { WorkflowStage } from "../workflowsModel";
import { PLAN_TITLE } from "./planDocument";
import "./proposalMockups.css";

export const STAGES = PROPOSAL_STAGES;
export const NOTE = "It runs in this chat. Nothing is saved to the repository.";

/** The modal. It grows to two panes' width when the window has room, and each axis gives up its margin before the content shrinks. */
export function Sheet({ variant, children }: { variant: "a" | "b" | "c"; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // As SheetDialog does: the sheet takes focus, so no control wears a ring until the reader moves.
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); frame.current?.focus({ preventScroll: true }); }, []);
  return <dialog ref={dialog} className="pm-sheet" data-variant={variant} aria-label={PLAN_TITLE}>
    <div ref={frame} className="pm-frame" tabIndex={-1}>{children}</div>
  </dialog>;
}

export function SheetHead() {
  return <header className="pm-head">
    <div className="pm-head-titles">
      <h2 className="pm-title">{PLAN_TITLE}</h2>
      <p className="pm-subtitle"><code>{PROPOSAL.name}</code><span>Proposed workflow, {STAGES.length} stages</span></p>
    </div>
    <button type="button" className="pm-icon-button" aria-label="Close the proposal" title="Close the proposal"><XIcon aria-hidden /></button>
  </header>;
}

export interface InputValues { task: string; base: string; rounds: number }
export const INITIAL_INPUTS: InputValues = { task: String(PROPOSAL.inputs.task), base: "main", rounds: 2 };

export function useInputs() { return useState<InputValues>(INITIAL_INPUTS); }

/** The three inputs: the task as text, the branch as a choice, the rounds as a number. */
export function InputFields({ values, onChange, layout = "stack" }: { values: InputValues; onChange: (next: InputValues) => void; layout?: "stack" | "bar" }) {
  return <div className="pm-fields" data-layout={layout}>
    <label className="pm-field pm-field-task">
      <span className="pm-field-label">Task</span>
      <textarea className="pm-textarea" rows={layout === "bar" ? 2 : 3} value={values.task} onChange={(event) => onChange({ ...values, task: event.target.value })} />
    </label>
    <div className="pm-field" role="radiogroup" aria-label="Branch to land on">
      <span className="pm-field-label">Branch to land on</span>
      <div className="pm-segments">
        {["main", "next"].map((branch) => <button key={branch} type="button" role="radio" aria-checked={values.base === branch} className="pm-segment"
          onClick={() => onChange({ ...values, base: branch })}><code>{branch}</code></button>)}
      </div>
    </div>
    <div className="pm-field">
      <span className="pm-field-label" id="pm-rounds">Review rounds</span>
      <div className="pm-stepper" role="group" aria-labelledby="pm-rounds">
        <button type="button" aria-label="Fewer rounds" disabled={values.rounds <= 1} onClick={() => onChange({ ...values, rounds: values.rounds - 1 })}><MinusIcon aria-hidden /></button>
        <output aria-live="polite">{values.rounds}</output>
        <button type="button" aria-label="More rounds" onClick={() => onChange({ ...values, rounds: values.rounds + 1 })}><PlusIcon aria-hidden /></button>
      </div>
      {layout === "stack" && <span className="pm-field-hint">The run stops and reports after this many.</span>}
    </div>
  </div>;
}

/** One planned worker is one hollow block. A stop for the reader is a "You" chip. */
export function StageMarks({ stage }: { stage: WorkflowStage }) {
  const workers = stage.workers ?? [];
  return <span className="pm-marks">
    {workers.length > 0 && <span className="pm-blocks" aria-label={`${String(workers.length)} ${workers.length === 1 ? "worker" : "workers"}`}>
      {workers.map((worker) => <span key={worker.name} className="pm-block" />)}
    </span>}
    {stage.stop !== undefined && <span className="pm-you">You</span>}
  </span>;
}

/** The workers of a stage, by name, agent and model. */
export function WorkerChips({ stage }: { stage: WorkflowStage }) {
  const workers = stage.workers ?? [];
  if (workers.length === 0) return stage.stop === undefined ? null
    : <p className="pm-workers"><span className="pm-worker"><span className="pm-you">You</span>{stage.stop === "land" ? "land the branches" : "approve before the next stage starts"}</span></p>;
  return <p className="pm-workers">{workers.map((worker) => <span key={worker.name} className="pm-worker">
    <span className="pm-block" aria-hidden /><code>{worker.name}</code><span>{worker.agent}{worker.model === undefined ? "" : `, ${worker.model.split("/").pop() ?? ""}`}</span>
  </span>)}</p>;
}

export function Actions({ layout = "row" }: { layout?: "row" | "rail" }) {
  return <div className="pm-actions" data-layout={layout}>
    <button type="button" className="pm-button" data-tone="primary">Start workflow</button>
    <button type="button" className="pm-button">Ask for changes</button>
    <button type="button" className="pm-button">Dismiss</button>
  </div>;
}

/** Collapsed inputs: one line that says what is set, and a control that opens the fields. */
export function InputSummary({ values, open, onToggle }: { values: InputValues; open: boolean; onToggle: () => void }) {
  return <button type="button" className="pm-input-summary" aria-expanded={open} onClick={onToggle}>
    <span className="pm-field-label">Inputs</span>
    <span className="pm-input-summary-text">{values.task}</span>
    <span className="pm-input-summary-meta"><code>{values.base}</code>, {values.rounds} rounds</span>
    <ChevronDownIcon aria-hidden className="pm-chevron" />
  </button>;
}
