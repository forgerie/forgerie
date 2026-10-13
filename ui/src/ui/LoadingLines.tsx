import "./LoadingLines.css";

/**
 * Atom: a list being read for the first time: a few pulsing bars of
 * different lengths and one quiet line that says what is being read.
 */
export function LoadingLines({ label, widths = [38, 90, 70] }: { label: string; widths?: readonly number[] }) {
  return <div className="loading-lines" role="status">
    {widths.map((width, index) => <span key={index} className="loading-lines-bar" aria-hidden="true" style={{ "--loading-lines-width": `${String(width)}%` }} />)}
    <span className="loading-lines-label">{label}</span>
  </div>;
}
