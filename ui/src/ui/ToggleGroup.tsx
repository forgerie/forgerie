import { useId } from "react";
import "./ToggleGroup.css";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** A number after the label, such as how many items the choice holds. */
  count?: number | undefined;
  title?: string | undefined;
}

/**
 * Molecule: a few choices of one setting, one pressed at a time, as quiet
 * buttons. Each button keeps a control-sized hit area while it is drawn
 * smaller. A lead puts the setting's name in front, so the row reads as a
 * sentence ("Send as Image File") and names the group.
 */
export function ToggleGroup<T extends string>({ label, lead, options, value, onChange, disabled = false }: {
  /** The group's accessible name. With a lead, the lead names it instead. */
  label: string;
  lead?: string | undefined;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const leadId = useId();
  const buttons = options.map((option) => <button key={option.value} type="button" className="toggle-group-option" title={option.title} disabled={disabled}
    aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
    {option.label}
    {option.count !== undefined && option.count > 0 && <span className="toggle-group-count">{option.count}</span>}
  </button>);
  return <div className="toggle-group" role="group" {...lead ? { "aria-labelledby": leadId } : { "aria-label": label }} data-lead={lead ? true : undefined}>
    {lead && <span id={leadId} className="toggle-group-lead">{lead}</span>}
    {lead ? <span className="toggle-group-track">{buttons}</span> : buttons}
  </div>;
}
