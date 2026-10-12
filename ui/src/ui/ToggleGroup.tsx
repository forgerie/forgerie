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
 * smaller. As a field in a form, it shows its label above the choices.
 */
export function ToggleGroup<T extends string>({ label, options, value, onChange, field = false }: {
  /** The group's accessible name. */
  label: string;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shows the label above the choices and leaves room after them, the way a text field in a form does. */
  field?: boolean;
}) {
  const id = useId();
  const group = <div className="toggle-group" role="group" aria-label={field ? undefined : label} aria-labelledby={field ? id : undefined}>
    {options.map((option) => <button key={option.value} type="button" className="toggle-group-option" title={option.title}
      aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
      {option.label}
      {option.count !== undefined && option.count > 0 && <span className="toggle-group-count">{option.count}</span>}
    </button>)}
  </div>;
  return field ? <div className="toggle-group-field"><span className="toggle-group-label" id={id}>{label}</span>{group}</div> : group;
}
