// Mockup only. The pieces of the proposal sheet: the modal, its header, the
// route, the inputs, and the decision at the foot. Layout lives in
// ProposalSheet.tsx and proposalMockups.css.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeftIcon, CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import type { WorkflowStage } from "../workflowsModel";
import type { InputSpec, InputValues } from "./planDocument";
import "./proposalMockups.css";

/** The modal. It grows to two panes' width when the window has room, and each axis gives up its margin before the content shrinks. */
export function Sheet({ label, children }: { label: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // As SheetDialog does: the sheet takes focus, so no control wears a ring until the reader moves.
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); frame.current?.focus({ preventScroll: true }); }, []);
  return <dialog ref={dialog} className="pm-sheet" aria-label={label}>
    <div ref={frame} className="pm-frame" tabIndex={-1}>{children}</div>
  </dialog>;
}

export function SheetHead({ title, name, stages }: { title: string; name: string; stages: number }) {
  return <header className="pm-head">
    <div className="pm-head-titles">
      <h2 className="pm-title" title={title}>{title}</h2>
      <p className="pm-subtitle">{name !== title && <code>{name}</code>}<span>{stages === 0 ? "Proposed workflow" : `Proposed workflow, ${String(stages)} stages`}</span></p>
    </div>
    <button type="button" className="pm-icon-button" aria-label="Close the proposal" title="Close the proposal"><XIcon aria-hidden /></button>
  </header>;
}

/** One planned worker is one hollow block. A stop for the reader is a "You" chip. */
function StageMarks({ stage }: { stage: WorkflowStage }) {
  const workers = stage.workers ?? [];
  return <span className="pm-marks">
    {workers.length > 0 && <span className="pm-blocks" aria-label={`${String(workers.length)} ${workers.length === 1 ? "worker" : "workers"}`}>
      {workers.map((worker) => <span key={worker.name} className="pm-block" />)}
    </span>}
    {stage.stop !== undefined && <span className="pm-you">You</span>}
  </span>;
}

function StageWho({ stage }: { stage: WorkflowStage }) {
  const workers = stage.workers ?? [];
  if (workers.length === 0) return <span className="pm-route-who">{stage.stop === "land" ? "You land the branches" : stage.stop === undefined ? "This chat" : "You approve"}</span>;
  if (workers.length > 3) return <span className="pm-route-who"><span>{workers.length} workers: {workers.map((worker) => worker.name).join(", ")}</span></span>;
  return <span className="pm-route-who">{workers.map((worker) => <span key={worker.name}><code>{worker.name}</code> {worker.agent}</span>)}</span>;
}

/** The stages in order. With `onJump`, a stage opens its section of the plan; `current` is the section in view. */
export function Route({ stages, current, onJump, linked }: {
  stages: readonly WorkflowStage[]; current?: string | undefined; onJump?: ((id: string) => void) | undefined;
  /** The stages that have a section in the plan. Only those jump. */
  linked?: readonly string[] | undefined;
}) {
  return <ol className="pm-route" role="list">
    {stages.map((stage, index) => {
      const content = <>
        <span className="pm-route-num">{index + 1}</span>
        <span className="pm-route-text"><span className="pm-route-name">{stage.name}</span><StageWho stage={stage} /></span>
        <StageMarks stage={stage} />
      </>;
      return <li key={stage.id}>{onJump === undefined || linked?.includes(stage.id) === false ? <div className="pm-route-stage">{content}</div>
        : <button type="button" className="pm-route-stage" aria-current={current === stage.id ? "location" : undefined}
          onClick={() => onJump(stage.id)}>{content}</button>}</li>;
    })}
  </ol>;
}

const LONG_TEXT = 48;
const valueText = (value: string) => value === "" ? "nothing" : value;

/** One input. A choice is a segmented control, a number a stepper, a yes or no a switch, and text a field that grows when the value is long. */
function InputControl({ spec, value, labelId, disabled, compact, onChange }: {
  spec: InputSpec; value: string; labelId: string; disabled: boolean; compact: boolean; onChange: (value: string) => void;
}) {
  if (spec.choices !== undefined && spec.choices.length > 0) return <div className="pm-segments" role="radiogroup" aria-labelledby={labelId}>
    {spec.choices.map((choice) => <button key={choice} type="button" role="radio" aria-checked={value === choice} className="pm-segment" disabled={disabled}
      onClick={() => onChange(choice)}><code>{choice}</code></button>)}
  </div>;
  if (spec.type === "boolean") return <div className="pm-segments" role="radiogroup" aria-labelledby={labelId}>
    {["true", "false"].map((choice) => <button key={choice} type="button" role="radio" aria-checked={value === choice} className="pm-segment" disabled={disabled}
      onClick={() => onChange(choice)}>{choice === "true" ? "Yes" : "No"}</button>)}
  </div>;
  if (spec.type === "number") {
    const number = Number(value || 0);
    // A small count steps; a port or an id is typed.
    if (number > 99) return <input className="pm-input pm-input-number" aria-labelledby={labelId} inputMode="numeric" value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value.replace(/[^\d]/gu, ""))} />;
    return <div className="pm-stepper" role="group" aria-labelledby={labelId}>
      <button type="button" aria-label="Less" disabled={disabled || number <= 0} onClick={() => onChange(String(number - 1))}><MinusIcon aria-hidden /></button>
      <output aria-live="polite">{number}</output>
      <button type="button" aria-label="More" disabled={disabled} onClick={() => onChange(String(number + 1))}><PlusIcon aria-hidden /></button>
    </div>;
  }
  if (spec.name === "task" || value.length > LONG_TEXT) return <textarea className="pm-textarea" aria-labelledby={labelId} rows={compact ? 2 : 3} value={value}
    disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  return <input className="pm-input" aria-labelledby={labelId} value={value} placeholder="Empty" disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

/** The declared inputs. An edited input says what the agent proposed and can go back to it. */
export function InputFields({ inputs, values, proposed, onChange, disabled = false, compact = false }: {
  inputs: readonly InputSpec[]; values: InputValues; proposed: InputValues; onChange: (next: InputValues) => void; disabled?: boolean; compact?: boolean;
}) {
  const id = useId();
  return <div className="pm-fields" data-compact={compact || undefined}>
    {inputs.map((spec) => {
      const value = values[spec.name] ?? "";
      const agent = proposed[spec.name] ?? "";
      const edited = value !== agent;
      const wide = spec.type === "string" && spec.choices === undefined;
      return <div key={spec.name} className="pm-field" data-wide={wide || undefined} data-edited={edited || undefined}>
        <span className="pm-field-head">
          <span className="pm-field-label" id={`${id}-${spec.name}`}>{spec.label}</span>
          {edited && <span className="pm-edited">Edited</span>}
        </span>
        <InputControl spec={spec} value={value} labelId={`${id}-${spec.name}`} disabled={disabled} compact={compact} onChange={(next) => onChange({ ...values, [spec.name]: next })} />
        {edited ? <span className="pm-field-hint">{agent.length > LONG_TEXT ? "The agent proposed a different value." : `The agent proposed ${valueText(agent)}.`}
          {!disabled && <button type="button" className="pm-reset" onClick={() => onChange({ ...values, [spec.name]: agent })}>Use the agent's</button>}</span>
          : spec.hint !== undefined && !compact ? <span className="pm-field-hint">{spec.hint}</span> : null}
      </div>;
    })}
  </div>;
}

/** Folded inputs: one line that says what is set, and opens the fields. */
export function InputSummary({ inputs, values, proposed, open, onToggle }: { inputs: readonly InputSpec[]; values: InputValues; proposed: InputValues; open: boolean; onToggle: () => void }) {
  const edits = inputs.filter(({ name }) => values[name] !== proposed[name]).length;
  const lead = inputs.find((spec) => spec.name === "task") ?? inputs[0];
  const rest = inputs.filter((spec) => spec !== lead && (values[spec.name] ?? "") !== "");
  return <button type="button" className="pm-input-summary" aria-expanded={open} onClick={onToggle}>
    <span className="pm-field-label">{inputs.length === 1 ? "Input" : `${String(inputs.length)} inputs`}</span>
    <span className="pm-input-summary-text">{lead === undefined ? "" : lead.name === "task" ? values[lead.name] : `${lead.label}: ${values[lead.name] ?? ""}`}</span>
    {rest.length > 0 && <span className="pm-input-summary-meta">{rest.slice(0, 2).map((spec) => values[spec.name]).join(", ")}{rest.length > 2 ? ", …" : ""}</span>}
    {edits > 0 && <span className="pm-edited">{edits} edited</span>}
    <ChevronDownIcon aria-hidden className="pm-chevron" />
  </button>;
}

export type Outcome = { kind: "started" } | { kind: "dismissed" } | { kind: "replaced" } | { kind: "changes"; note: string };

const OUTCOMES: Record<Outcome["kind"], { Icon: typeof CheckIcon; text: string }> = {
  started: { Icon: CheckIcon, text: "Started. The run shows above the composer." },
  dismissed: { Icon: XIcon, text: "Dismissed. Nothing ran." },
  replaced: { Icon: ArrowRightLeftIcon, text: "A newer proposal from the agent replaced this one." },
  changes: { Icon: ArrowRightLeftIcon, text: "You asked for changes. The agent proposes again." },
};

/** The decided proposal says its decision in one line, and goes quiet. */
export function Decided({ outcome }: { outcome: Outcome }) {
  const { Icon, text } = OUTCOMES[outcome.kind];
  return <div className="pm-decided" role="status">
    <p className="pm-decided-line"><Icon aria-hidden />{text}</p>
    {outcome.kind === "changes" && <blockquote className="pm-decided-note">{outcome.note}</blockquote>}
  </div>;
}

/** The note for changes replaces the buttons while it is open. */
export function ChangesBox({ busy, onBack, onSend }: { busy: boolean; onBack: () => void; onSend: (note: string) => void }) {
  const [text, setText] = useState("");
  const id = useId();
  return <form className="pm-changes" onSubmit={(event) => { event.preventDefault(); if (text.trim() !== "") onSend(text.trim()); }}>
    <label className="pm-field-label" htmlFor={id}>What should change in this workflow?</label>
    <textarea id={id} className="pm-textarea" rows={3} placeholder="Say what to change" autoFocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
    <div className="pm-actions">
      <button type="submit" className="pm-button" data-tone="primary" disabled={busy || text.trim() === ""}>Send changes</button>
      <button type="button" className="pm-button" disabled={busy} onClick={onBack}>Back</button>
    </div>
  </form>;
}

export function Actions({ startLabel, canStart, busy, onStart, onChanges, onDismiss }: {
  startLabel: string; canStart: boolean; busy: boolean; onStart: () => void; onChanges: () => void; onDismiss: () => void;
}) {
  return <div className="pm-actions" data-decide>
    <button type="button" className="pm-button" data-tone="primary" disabled={busy || !canStart} onClick={onStart}>{startLabel}</button>
    <button type="button" className="pm-button" disabled={busy} onClick={onChanges}>Ask for changes</button>
    <button type="button" className="pm-button" disabled={busy} onClick={onDismiss}>Dismiss</button>
  </div>;
}
