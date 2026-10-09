import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { OptionRow, type OptionDetail } from "./OptionRow";
import { useMenu } from "./useMenu";
import { usePanelPlacement } from "./usePanelPlacement";
import "./SplitButton.css";

export interface SplitChoice<T extends string> {
  value: T;
  label: string;
  /** What the choice does, under its name in the menu, so it reads without hover. */
  details?: readonly OptionDetail[] | undefined;
}

/** The setting a split button carries in its second half. */
export interface SplitSetting<T extends string> {
  /** The setting's name: the menu's title, and the start of the half's accessible name. */
  label: string;
  value: T;
  options: readonly SplitChoice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
}

/** The menu's least width, so its details read on a narrow button. */
const MENU_MIN_REM = 19;
const MENU_CAP = 320;

/**
 * Molecule: an action and the one setting that changes what it does, joined
 * in one chip. The first half runs the action. The second half shows the
 * setting in effect and opens its choices at window level, each with what it
 * does under its name. Without a setting the chip is the action alone.
 * `compact` draws the action as its icon only; the label stays its name.
 */
export function SplitButton<T extends string>({ icon, label, title, disabled = false, compact = false, onPress, setting }: {
  icon: ReactNode;
  label: string;
  title?: string | undefined;
  disabled?: boolean;
  compact?: boolean;
  onPress: () => void;
  setting?: SplitSetting<T> | undefined;
}) {
  const menu = useMenu();
  const { open, setOpen } = menu;
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const current = setting?.options.find((option) => option.value === setting.value);
  const blocked = !setting || setting.disabled === true;
  useEffect(() => { if (blocked) setOpen(false); }, [blocked, setOpen]);
  useEffect(() => {
    if (!open) return;
    const rows = panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? rows?.[0])?.focus({ preventScroll: true });
  }, [open]);
  usePanelPlacement(panel, menu.anchor, MENU_CAP, MENU_MIN_REM, open);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
  };
  return <div ref={menu.anchor} className="split-button" data-split={setting ? true : undefined} data-compact={compact || undefined}>
    <button type="button" className="split-button-main" aria-label={compact ? label : undefined} title={title ?? label} disabled={disabled} onClick={onPress}>
      {icon}{!compact && <span>{label}</span>}
    </button>
    {setting && <button ref={trigger} type="button" className="split-button-setting" aria-haspopup="menu" aria-expanded={open}
      aria-label={`${setting.label}: ${current?.label ?? setting.value}`} title={`${setting.label}: ${current?.label ?? setting.value}`}
      disabled={setting.disabled} onClick={() => setOpen(!open)}>
      <span>{current?.label ?? setting.value}</span><ChevronDownIcon aria-hidden size={14} />
    </button>}
    {open && setting && <FloatingPanel ref={panel} role="menu" aria-labelledby={titleId} onKeyDown={move}>
      <p id={titleId} className="split-button-title">{setting.label}</p>
      {setting.options.map((option) => <OptionRow key={option.value} role="menuitemradio" aria-checked={option.value === setting.value}
        name={option.label} details={option.details} current={option.value === setting.value}
        onClick={() => { setting.onChange(option.value); close(); }} />)}
    </FloatingPanel>}
  </div>;
}
