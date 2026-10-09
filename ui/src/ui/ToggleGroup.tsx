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
 * smaller.
 */
export function ToggleGroup<T extends string>({ label, options, value, onChange }: {
  /** The group's accessible name. */
  label: string;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return <div className="toggle-group" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" className="toggle-group-option" title={option.title}
      aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
      {option.label}
      {option.count !== undefined && option.count > 0 && <span className="toggle-group-count">{option.count}</span>}
    </button>)}
  </div>;
}
