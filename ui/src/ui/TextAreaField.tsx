import { useId } from "react";
import "./TextAreaField.css";

/**
 * Atom: a labelled text box for a few lines of prose, with an optional hint
 * under it. It grows with its text up to a share of its container, then
 * scrolls inside.
 */
export function TextAreaField({ label, value, onChange, hint, placeholder, rows = 3 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  placeholder?: string | undefined;
  rows?: number;
}) {
  const id = useId();
  return <div className="text-area-field">
    <label className="text-area-field-label" htmlFor={id}>{label}</label>
    <textarea id={id} className="text-area-field-input" value={value} rows={rows} placeholder={placeholder}
      aria-describedby={hint === undefined ? undefined : `${id}-hint`} onChange={(event) => onChange(event.target.value)} />
    {hint !== undefined && <p id={`${id}-hint`} className="text-area-field-hint">{hint}</p>}
  </div>;
}
