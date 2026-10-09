import { useId } from "react";
import "./ChoiceSelect.css";
export function ChoiceSelect({ label, value, options, onChoose, action }: {
  label: string; value: string; options: readonly { value: string; label: string }[]; onChoose: (value: string) => void;
  action?: { label: string; onPress: () => void } | undefined;
}) {
  const id = useId();
  return <div className="choice-select"><label className="choice-select-label" htmlFor={id}>{label}</label>
    <select className="choice-select-input" id={id} value={value} onChange={(event) => onChoose(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>{action && <button className="choice-select-action" type="button" onClick={action.onPress}>{action.label}</button>}</div>;
}
