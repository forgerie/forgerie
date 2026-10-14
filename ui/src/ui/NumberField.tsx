import { useId } from "react";
import "./NumberField.css";

/** Atom: an editable number with step buttons that remain reachable on touch screens. Empty stays empty until edited. */
export function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const step = (amount: number) => {
    const next = (value.trim() === "" ? 0 : Number(value)) + amount;
    if (Number.isFinite(next)) onChange(String(next));
  };
  return <div className="number-field">
    <label htmlFor={id}>{label}</label>
    <div className="number-field-control">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => step(-1)}>−</button>
      <input id={id} type="number" step="any" value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => step(1)}>+</button>
    </div>
  </div>;
}
