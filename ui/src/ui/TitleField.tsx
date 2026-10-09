import "./TitleField.css";

/**
 * Atom: a document's title, typed in place. It reads as the page's heading,
 * not as a form box; a rule under it marks the caret. The hint under it is the
 * document's standfirst.
 */
export function TitleField({ label, value, placeholder, hint, disabled, maxLength, onChange }: {
  label: string; value: string; placeholder: string; hint?: string | undefined; disabled?: boolean | undefined; maxLength?: number | undefined;
  onChange: (value: string) => void;
}) {
  return <div className="title-field">
    <input className="title-field-input" aria-label={label} placeholder={placeholder} value={value} disabled={disabled} maxLength={maxLength}
      autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    {hint ? <p className="title-field-hint">{hint}</p> : null}
  </div>;
}
