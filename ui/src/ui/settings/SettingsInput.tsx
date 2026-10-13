import "./SettingsInput.css";
/** A typed settings value using the input style shared by Settings pages. */
export function SettingsInput({ label, value, onChange, disabled = false, type = "text", required = false, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; type?: "text" | "url"; required?: boolean; placeholder?: string;
}) {
  return <input className="settings-input" type={type} aria-label={label} value={value} disabled={disabled} required={required} placeholder={placeholder}
    autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />;
}
