import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { ChoiceList } from "./ChoiceList";
import { usePanelPlacement } from "./usePanelPlacement";
import { usePortalTarget } from "./portalLayer";
import "./ChoicePicker.css";

const PANEL_CAP = 448;
const PANEL_MIN_REM = 18;

/**
 * Molecule: any number of choices as one chip, with optional words before it
 * ("Runs in"). A press opens a `ChoiceList` at window level, so a narrow pane
 * never clips it; it stays open while the reader checks rows, and Done, Escape,
 * or a press outside closes it. The chip says the choice in effect, or a prompt
 * when there is none.
 */
export function ChoicePicker({ label, lead, icon, value, placeholder, title, disabled, doneLabel = "Done", list }: {
  /** The panel's accessible name, and the chip's before its value, such as "Target projects". */
  label: string;
  /** Words before the chip, such as "Runs in". */
  lead?: string | undefined;
  icon?: ReactNode;
  /** The chip's words for the choice in effect; absent while nothing is chosen. */
  value?: string | undefined;
  placeholder: string;
  /** The chip's tooltip, such as every chosen name. */
  title?: string | undefined;
  disabled?: boolean | undefined;
  doneLabel?: string | undefined;
  list: Omit<ComponentProps<typeof ChoiceList>, "disabled">;
}) {
  const [open, setOpen] = useState(false);
  const layer = usePortalTarget();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  // Disabled while open (a save starts), the panel closes at once: it lives outside any form lock, so it must not stay
  // to take a choice.
  const visible = open && !disabled;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus({ preventScroll: true }); };
  usePanelPlacement(panel, anchor, PANEL_CAP, PANEL_MIN_REM, visible);
  useLayoutEffect(() => {
    if (visible) panel.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus({ preventScroll: true });
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [visible]);
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.current?.contains(next)) close(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); close(true);
  };
  return <div ref={anchor} className="choice-picker">
    {icon}
    {lead ? <span className="choice-picker-lead" id={`${id}-lead`}>{lead}</span> : null}
    <button ref={trigger} type="button" className="choice-picker-trigger" disabled={disabled} data-empty={value ? undefined : ""}
      aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible ? id : undefined}
      aria-label={`${label}: ${lead ? `${lead} ` : ""}${value ?? placeholder}`} title={title ?? value ?? placeholder}
      onClick={() => { if (open) close(false); else setOpen(true); }}>
      <span className="choice-picker-value">{value ?? placeholder}</span><ChevronDownIcon aria-hidden size={14} />
    </button>
    {visible ? createPortal(<FloatingPanel ref={panel} id={id} role="dialog" tabIndex={-1} aria-label={label} onBlur={onBlur} onKeyDown={onKeyDown}>
      <div className="choice-picker-body"><ChoiceList {...list} /></div>
      <div className="choice-picker-foot">
        <button type="button" className="choice-picker-done" onClick={() => close(true)}>{doneLabel}</button>
      </div>
    </FloatingPanel>, layer) : null}
  </div>;
}
