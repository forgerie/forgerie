import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, type KeyboardEvent, type Ref } from "react";
import "./SearchField.css";

/**
 * Atom: one search box over a list. The magnifier and the box share one
 * control-sized row; the label names what it searches, for a screen reader
 * and as the placeholder. With `clear`, a ✕ empties a typed box and Escape
 * does the same. `busy` turns the magnifier into a spinner while an answer
 * is on its way. A `hint` sits under the box and describes it.
 * The bare variant draws no box: it sits in a row that already draws an edge,
 * such as a header, and that row marks focus.
 */
export function SearchField({ label, value, onChange, clear, busy = false, busyLabel, hint, describedBy, keyShortcuts, inputRef, onKeyDown, variant = "box" }: {
  label: string; value: string; onChange: (value: string) => void;
  /** The ✕ button's accessible name, and what it and Escape do. Drawn only while the box holds text. */
  clear?: { label: string; onClear: () => void } | undefined;
  busy?: boolean;
  /** Announced while busy, such as "Searching". */
  busyLabel?: string | undefined;
  hint?: string | undefined;
  /** The id of a description its owner draws elsewhere, used when the field draws no `hint` of its own. */
  describedBy?: string | undefined;
  /** The keys that reach the box from anywhere, for `aria-keyshortcuts`, such as "Control+K /". */
  keyShortcuts?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  variant?: "box" | "bare" | undefined;
}) {
  const hintId = useId();
  const typed = value !== "";
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // A search input empties itself on Escape; the owner clears what hangs on the query too.
    if (event.key === "Escape" && clear && typed) { event.preventDefault(); event.stopPropagation(); clear.onClear(); return; }
    onKeyDown?.(event);
  };
  return <div className="search-field" data-variant={variant === "bare" ? "bare" : undefined}>
    <label className="search-field-box">
      {busy ? <LoaderCircleIcon className="search-field-spinner" aria-hidden size={16} /> : <SearchIcon aria-hidden size={16} />}
      <input ref={inputRef} type="search" className="search-field-input" placeholder={label} aria-label={label} value={value} enterKeyHint="search"
        aria-describedby={hint ? hintId : describedBy} aria-keyshortcuts={keyShortcuts}
        onChange={(event) => onChange(event.target.value)} onKeyDown={keyDown} />
      {clear && typed ? <button type="button" className="search-field-clear" aria-label={clear.label} title={clear.label}
        onClick={clear.onClear}><XIcon aria-hidden size={14} /></button> : null}
    </label>
    {busy && busyLabel ? <span className="search-field-status" role="status">{busyLabel}</span> : null}
    {hint ? <p id={hintId} className="search-field-hint">{hint}</p> : null}
  </div>;
}
