import "./TimeField.css";

/**
 * Atom: a time of day as `HH:mm`, typed or picked with the browser's own
 * control, which shows it in the reader's locale.
 */
export function TimeField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean | undefined;
}) {
  return <input type="time" className="time-field" aria-label={label} value={value} disabled={disabled} required step={60}
    onChange={(event) => { if (event.target.value) onChange(event.target.value); }} />;
}
