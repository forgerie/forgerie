import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { OptionList, type OptionItem, type OptionListHandle, type OptionStatus } from "./OptionList";
import { usePanelPlacement } from "./usePanelPlacement";
import { usePortalTarget } from "./portalLayer";
import "./OptionPicker.css";

const PANEL_CAP = 416;
const PANEL_MIN_REM = 20;

/**
 * Molecule: one choice shown as a chip that opens its options at window
 * level, so a narrow pane never clips them. The options can be searched, and
 * a blocked one shows why it cannot be chosen. The chip says the choice in
 * effect, or a prompt when there is none.
 */
export function OptionPicker({ label, value, placeholder, icon, options, search, status, disabled, onChoose }: {
  /** The chip's accessible name before its value, such as "Workflow". */
  label: string;
  value?: string | undefined;
  /** The chip's words while nothing is chosen. */
  placeholder: string;
  icon?: ReactNode;
  options: readonly OptionItem[];
  /** Search words: the field's label, which is also its placeholder. Without it, no search field. */
  search?: string | undefined;
  /** One line about the options, such as an empty list or a failed read. */
  status?: OptionStatus | undefined;
  disabled?: boolean | undefined;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const layer = usePortalTarget();
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<OptionListHandle>(null);
  const panelId = useId();
  const close = (returnFocus: boolean) => { setOpen(false); setQuery(""); if (returnFocus) trigger.current?.focus({ preventScroll: true }); };
  // A picker that becomes disabled while open (a save starts) closes at once: its panel lives outside any form lock,
  // so it must not stay to take a choice. `visible` hides it in the same render; the effect forgets that it was open.
  const visible = open && !disabled;
  useEffect(() => { if (disabled) { setOpen(false); setQuery(""); } }, [disabled]);
  usePanelPlacement(panel, anchor, PANEL_CAP, PANEL_MIN_REM, visible);
  useLayoutEffect(() => {
    if (!visible) return;
    // With search, typing starts at once; without it, the choice in effect takes focus.
    const field = panel.current?.querySelector<HTMLInputElement>("input");
    if (field) field.focus({ preventScroll: true }); else if (!list.current?.focus()) panel.current?.focus({ preventScroll: true });
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) { setOpen(false); setQuery(""); }
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
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((option) => [option.name, option.variant ?? ""].some((text) => text.toLowerCase().includes(needle))) : options;
  const line: OptionStatus | undefined = status ?? (shown.length === 0 && needle ? { tone: "status", text: `Nothing matches “${query.trim()}”.` } : undefined);
  return <span ref={anchor} className="option-picker">
    <button ref={trigger} type="button" className="option-picker-trigger" disabled={disabled} data-empty={value ? undefined : ""}
      aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible ? panelId : undefined} aria-label={`${label}: ${value ?? placeholder}`}
      title={value ?? placeholder} onClick={() => { if (open) close(false); else setOpen(true); }}>
      {icon}<span className="option-picker-value">{value ?? placeholder}</span><ChevronDownIcon aria-hidden size={14} />
    </button>
    {visible ? createPortal(<FloatingPanel ref={panel} id={panelId} role="dialog" tabIndex={-1} aria-label={label} onBlur={onBlur} onKeyDown={onKeyDown}>
      <OptionList ref={list} label={label} groups={[{ key: "options", options: shown }]} status={line}
        search={search ? { value: query, onChange: setQuery, label: search, placeholder: search } : undefined}
        input={{ type: "focus", onChoose: (choice) => { if (disabled || options.find((option) => option.id === choice)?.blocked) return; onChoose(choice); close(true); } }} />
    </FloatingPanel>, layer) : null}
  </span>;
}
