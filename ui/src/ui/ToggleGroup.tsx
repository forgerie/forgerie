import { useId } from "react";
import "./ToggleGroup.css";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** A number after the label, such as how many items the choice holds. */
  count?: number | undefined;
  title?: string | undefined;
  /** Shown but not choosable now; say why in `title` and somewhere the reader can see it. */
  disabled?: boolean | undefined;
}

/** One pressed at a time, or (`multiple`) any number, with the value as the list of pressed options. */
type Choice<T extends string> =
  | { multiple?: false | undefined; value: T; onChange: (value: T) => void }
  | { multiple: true; value: readonly T[]; onChange: (value: T[]) => void };

/**
 * Molecule: a few choices of one setting, one pressed at a time, as quiet
 * buttons. Each button keeps a control-sized hit area while it is drawn
 * smaller. As a field in a form, it shows its label above the choices.
 * With `multiple`, any number can be pressed, such as days of the week; the
 * value keeps the options' order. The buttons wrap when the row is narrow.
 */
export function ToggleGroup<T extends string>(props: {
  /** The group's accessible name. */
  label: string;
  options: readonly ToggleOption<T>[];
  /** Shows the label above the choices and leaves room after them, the way a text field in a form does. */
  field?: boolean;
} & Choice<T>) {
  const { label, options, field = false } = props;
  const id = useId();
  const pressed = (value: T) => props.multiple ? props.value.includes(value) : props.value === value;
  const press = (value: T) => {
    if (!props.multiple) { props.onChange(value); return; }
    const next = new Set(props.value);
    if (next.has(value)) next.delete(value); else next.add(value);
    props.onChange(options.map((option) => option.value).filter((option) => next.has(option)));
  };
  const group = <div className="toggle-group" role="group" aria-label={field ? undefined : label} aria-labelledby={field ? id : undefined}>
    {options.map((option) => <button key={option.value} type="button" className="toggle-group-option" title={option.title}
      disabled={option.disabled} aria-pressed={pressed(option.value)} onClick={() => press(option.value)}>
      {option.label}
      {option.count !== undefined && option.count > 0 && <span className="toggle-group-count">{option.count}</span>}
    </button>)}
  </div>;
  return field ? <div className="toggle-group-field"><span className="toggle-group-label" id={id}>{label}</span>{group}</div> : group;
}
