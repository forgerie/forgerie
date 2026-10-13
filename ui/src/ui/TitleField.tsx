import "./TitleField.css";

/**
 * Atom: a document's title, typed in place. It reads as the page's heading,
 * not as a form box; a rule under it marks the caret. The hint under it is the
 * document's standfirst.
 */
export function TitleField({ label, value, placeholder, hint, problem, disabled, maxLength, autoFocus, onChange }: {
  label: string; value: string; placeholder: string; hint?: string | undefined; disabled?: boolean | undefined; maxLength?: number | undefined;
  /** What is wrong with the title, under it in the danger tone. */
  problem?: string | undefined;
  /** Takes focus when it appears, such as when the reader asked to edit. */
  autoFocus?: boolean | undefined;
  onChange: (value: string) => void;
}) {
  return <div className="title-field" data-problem={problem ? "" : undefined}>
    <input className="title-field-input" aria-label={label} placeholder={placeholder} value={value} disabled={disabled} maxLength={maxLength}
      autoComplete="off" spellCheck={false} autoFocus={autoFocus} aria-invalid={problem ? true : undefined} onChange={(event) => onChange(event.target.value)} />
    {hint ? <p className="title-field-hint">{hint}</p> : null}
    {problem ? <p className="title-field-problem">{problem}</p> : null}
  </div>;
}
