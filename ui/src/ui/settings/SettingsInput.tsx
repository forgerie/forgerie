import "./SettingsInput.css";
/** A typed settings value using the input style shared by Settings pages. */
export function SettingsInput({ label, value, onChange, disabled = false, type = "text", required = false, placeholder, choices }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; type?: "text" | "url"; required?: boolean; placeholder?: string; choices?: readonly string[];
}) {
  if (choices) return <select className="settings-input" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
  </select>;
  return <input className="settings-input" type={type} aria-label={label} value={value} disabled={disabled} required={required} placeholder={placeholder}
    autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />;
}
