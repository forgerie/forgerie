import { useId, useState } from "react";
import "./TextSubmit.css";
export function TextSubmit({ label, action, placeholder, pending, onSubmit }: {
  label: string; action: string; placeholder: string; pending: boolean; onSubmit: (value: string) => Promise<void>;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  return <form className="text-submit" onSubmit={(event) => { event.preventDefault(); void onSubmit(value.trim()).then(() => setValue("")).catch(() => undefined); }}>
    <label className="text-submit-label" htmlFor={id}>{label}</label>
    <input className="text-submit-input" id={id} placeholder={placeholder} value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} />
    <button className="text-submit-button" type="submit" disabled={pending || !value.trim()}>{action}</button>
  </form>;
}
