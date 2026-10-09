import { useId, useState } from "react";
import "./TextSubmit.css";

/**
 * Molecule: one typed value and the action that sends it. The label sits
 * above; the field and the button share a row while the container has room,
 * and the button drops under the field when it does not. A refused value
 * stays in the field so the reader can fix it.
 */
export function TextSubmit({ label, hint, action, placeholder, pending, onSubmit }: {
  label: string; hint?: string | undefined; action: string; placeholder: string; pending: boolean; onSubmit: (value: string) => Promise<void>;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  return <form className="text-submit" onSubmit={(event) => { event.preventDefault(); void onSubmit(value.trim()).then(() => setValue("")).catch(() => undefined); }}>
    <label className="text-submit-label" htmlFor={id}>{label}</label>
    {hint ? <p className="text-submit-hint" id={`${id}-hint`}>{hint}</p> : null}
    <div className="text-submit-row">
      <input className="text-submit-input" id={id} placeholder={placeholder} value={value} disabled={pending} aria-describedby={hint ? `${id}-hint` : undefined}
        autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setValue(event.target.value)} />
      <button className="text-submit-button" type="submit" disabled={pending || !value.trim()}>{action}</button>
    </div>
  </form>;
}
