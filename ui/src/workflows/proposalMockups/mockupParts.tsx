// Mockup only. The pieces of the proposal sheet: the modal, its header, the
// route, the inputs, and the decision at the foot. Layout lives in
// ProposalSheet.tsx and proposalMockups.css.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeftIcon, CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import type { InputSpec, InputValues } from "./planDocument";
import { PortalLayerProvider } from "../../ui/portalLayer";
import "./proposalMockups.css";

/** The modal. It grows to two panes' width when the window has room, and each axis gives up its margin before the content shrinks. */
export function Sheet({ label, children }: { label: string; children: ReactNode }) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  // As SheetDialog does: the sheet takes focus, so no control wears a ring until the reader moves.
  useEffect(() => { if (dialog && !dialog.open) dialog.showModal(); frame.current?.focus({ preventScroll: true }); }, [dialog]);
  // Pickers mount in the dialog, which has no container query, so they escape the rail.
  return <dialog ref={setDialog} className="pm-sheet" aria-label={label}>
    <PortalLayerProvider value={dialog}><div ref={frame} className="pm-frame" tabIndex={-1}>{children}</div></PortalLayerProvider>
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

/** The note for changes replaces the buttons while it is open. With route changes, they go first and the note is optional. */
export function ChangesBox({ busy, changes, onBack, onSend }: { busy: boolean; changes?: readonly string[] | undefined; onBack: () => void; onSend: (note: string) => void }) {
  const [text, setText] = useState("");
  const id = useId();
  const needsText = changes === undefined;
  return <form className="pm-changes" onSubmit={(event) => { event.preventDefault(); if (!needsText || text.trim() !== "") onSend(text.trim()); }}>
    {changes !== undefined && <p className="pm-field-hint">{changes.length} route {changes.length === 1 ? "change goes" : "changes go"} to the agent.</p>}
    <label className="pm-field-label" htmlFor={id}>{needsText ? "What should change in this workflow?" : "Anything else to change? (optional)"}</label>
    <textarea id={id} className="pm-textarea" rows={needsText ? 3 : 2} placeholder="Say what to change" autoFocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
    <div className="pm-actions">
      <button type="submit" className="pm-button" data-tone="primary" disabled={busy || (needsText && text.trim() === "")}>{needsText ? "Send changes" : "Send to the agent"}</button>
      <button type="button" className="pm-button" disabled={busy} onClick={onBack}>Back</button>
    </div>
  </form>;
}

/** With route changes the plan must be updated first: Update the plan takes Start's place, and Start waits. */
export function Actions({ startLabel, canStart, busy, update = false, onStart, onChanges, onDismiss }: {
  startLabel: string; canStart: boolean; busy: boolean; update?: boolean; onStart: () => void; onChanges: () => void; onDismiss: () => void;
}) {
  return <div className="pm-actions" data-decide>
    {update ? <button type="button" className="pm-button" data-tone="primary" disabled={busy} onClick={onChanges}>Update the plan</button>
      : <button type="button" className="pm-button" data-tone="primary" disabled={busy || !canStart} onClick={onStart}>{startLabel}</button>}
    {update ? <button type="button" className="pm-button" disabled>Start workflow</button>
      : <button type="button" className="pm-button" disabled={busy} onClick={onChanges}>Ask for changes</button>}
    <button type="button" className="pm-button" disabled={busy} onClick={onDismiss}>Dismiss</button>
  </div>;
}
