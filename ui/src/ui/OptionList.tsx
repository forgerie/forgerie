import { forwardRef, useId, useImperativeHandle, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { OptionRow, type OptionDetail, type OptionTone } from "./OptionRow";
import "./OptionList.css";

export interface OptionItem {
  id: string;
  name: string;
  icon?: ReactNode;
  variant?: string | undefined;
  details?: readonly OptionDetail[] | undefined;
  current?: boolean | undefined;
  tone?: OptionTone | undefined;
  blocked?: boolean | undefined;
  busy?: boolean | undefined;
}
/** Choices under one optional heading. Groups keep the order they are given. */
export interface OptionGroup { key: string; label?: string | undefined; options: readonly OptionItem[] }
/** One line about the list: progress or an empty result (`status`), or a failure (`alert`). */
export interface OptionStatus { tone: "status" | "alert"; text: string }
/** A command at the foot of the list, such as showing the choices it leaves out. */
export interface OptionAction { label: string; icon?: ReactNode; pressed?: boolean | undefined; onPress: () => void }
export interface OptionSearch { value: string; onChange: (value: string) => void; label: string; placeholder: string }

/**
 * How a person moves through the rows. The two modes differ in where focus
 * lives, so a host picks one and the list draws the markup that mode needs.
 *
 * - `focus`: rows take focus. The arrow keys move it, from the search field
 *   too, and a press chooses.
 * - `highlight`: focus stays in a text field outside the list, whose arrow
 *   keys move a highlight. `wrap` gives each row that field's behaviour,
 *   usually a primitive with `asChild`. Rows and the action never take focus.
 */
export type OptionInput =
  | { type: "focus"; onChoose: (id: string) => void }
  | { type: "highlight"; wrap: (row: ReactElement, option: OptionItem) => ReactElement };

export interface OptionListHandle {
  /** Focus the row with this id, else the current row, else the first. False when there is no row. */
  focus: (id?: string) => boolean;
}

/**
 * Molecule: choices in named groups, with an optional search field above,
 * one status line, and an optional command at the foot. It fills the room its
 * container gives it and scrolls the rows inside that room, so it works in a
 * window-level panel, a popover, or a page section alike.
 */
export const OptionList = forwardRef<OptionListHandle, {
  /** The list's accessible name. */
  label: string;
  groups: readonly OptionGroup[];
  input: OptionInput;
  search?: OptionSearch | undefined;
  /** A failure the reader must see, above the rows and below the search. */
  alert?: string | undefined;
  status?: OptionStatus | undefined;
  action?: OptionAction | undefined;
}>(function OptionList({ label, groups, input, search, alert, status, action }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const rows = () => [...(root.current?.querySelectorAll<HTMLButtonElement>(".option-row") ?? [])];
  useImperativeHandle(ref, () => ({
    focus: (target) => {
      const all = rows();
      const row = all.find((item) => target !== undefined && item.dataset.optionId === target)
        ?? all.find((item) => item.getAttribute("aria-current") === "true") ?? all[0];
      row?.focus({ preventScroll: false });
      return row !== undefined;
    },
  }), []);
  const highlight = input.type === "highlight";
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (highlight || event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = rows();
    if (all.length === 0) return;
    event.preventDefault();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const down = event.key === "ArrowDown";
    const next = index === -1 ? (down ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, index + (down ? 1 : -1)));
    all[next]?.focus();
  }
  const row = (option: OptionItem) => {
    const drawn = <OptionRow name={option.name} icon={option.icon} variant={option.variant} details={option.details}
      current={option.current} tone={option.tone} blocked={option.blocked} busy={option.busy} data-option-id={option.id}
      {...(highlight ? { tabIndex: -1, onMouseDown: (event) => event.preventDefault() } : { onClick: () => input.onChoose(option.id) })} />;
    return highlight ? input.wrap(drawn, option) : drawn;
  };
  return <div ref={root} className="option-list" onKeyDown={onKeyDown}>
    {search && <input type="search" className="option-list-search" placeholder={search.placeholder} aria-label={search.label}
      value={search.value} onChange={(event) => search.onChange(event.target.value)} enterKeyHint="search" />}
    {alert && <p className="option-list-alert" role="alert">{alert}</p>}
    <div className="option-list-rows" aria-label={highlight ? undefined : label} role={highlight ? undefined : "group"}>
      {groups.map((group) => {
        const heading = group.label ? `${id}-${group.key}` : undefined;
        return highlight
          ? <div key={group.key} className="option-list-group" role="group" aria-labelledby={heading}>
            {group.label && <span className="option-list-heading" id={heading}>{group.label}</span>}
            {group.options.map((option) => <div key={option.id} role="presentation">{row(option)}</div>)}
          </div>
          : <section key={group.key} className="option-list-group" aria-labelledby={heading}>
            {group.label && <h3 className="option-list-heading" id={heading}>{group.label}</h3>}
            <ul className="option-list-items">{group.options.map((option) => <li key={option.id}>{row(option)}</li>)}</ul>
          </section>;
      })}
      {status && <p className="option-list-status" role={status.tone}>{status.text}</p>}
      {action && <button type="button" className="option-list-action" aria-pressed={action.pressed}
        {...(highlight ? { tabIndex: -1, onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault() } : {})}
        onClick={action.onPress}>{action.icon}{action.label}</button>}
    </div>
  </div>;
});
