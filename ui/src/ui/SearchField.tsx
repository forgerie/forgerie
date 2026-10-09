import { SearchIcon } from "lucide-react";
import "./SearchField.css";

/**
 * Atom: one search box over a list. The magnifier and the box share one
 * control-sized row; the label names what it searches, for a screen reader
 * and as the placeholder.
 */
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="search-field">
    <SearchIcon aria-hidden size={16} />
    <input type="search" className="search-field-input" placeholder={label} aria-label={label} value={value} enterKeyHint="search"
      onChange={(event) => onChange(event.target.value)} />
  </label>;
}
