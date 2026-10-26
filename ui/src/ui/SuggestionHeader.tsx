import { XIcon } from "lucide-react";
import "./SuggestionHeader.css";

/** Molecule: a suggestion list’s name and dismissal, without taking focus from its input. */
export function SuggestionHeader({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return <div className="suggestion-header">
    <span>{label}</span>
    <button type="button" className="suggestion-header-close" tabIndex={-1} aria-label={`Dismiss ${label.toLowerCase()} suggestions`}
      onMouseDown={(event) => event.preventDefault()} onClick={onDismiss}><XIcon size={14} aria-hidden /></button>
  </div>;
}
