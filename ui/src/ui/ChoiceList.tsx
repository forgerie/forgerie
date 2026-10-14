import { useId, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import "./ChoiceList.css";

export interface Choice { id: string; label: string; detail?: string | undefined }
/**
 * One row above the others that chooses every row, including rows that are added later. While it is on, every row
 * shows as chosen and cannot be changed one by one.
 */
export interface EveryChoice { label: string; detail?: string | undefined; on: boolean; onChange: (on: boolean) => void }

/** A long list gets a search field. Below this, every row is in view at a glance. */
export const SEARCH_FROM = 9;

/**
 * Molecule: pick any number of items from a list. Each row is one full-width
 * target: a box, a name, and a quiet second line. The legend counts what is
 * chosen. A long list gets a search field that hides rows but never changes
 * what is chosen. A chosen id with no row stays listed as `missing`, so the
 * reader can see it and remove it. An `every` row at the top can choose
 * every row, now and later, in one press; the rows below then show chosen.
 */
export function ChoiceList({ legend, choices, chosen, missing, search, disabled, every, onChange }: {
  legend: string;
  choices: readonly Choice[];
  chosen: readonly string[];
  /** The name for a chosen id that no row matches. */
  missing: string;
  /** The search field's label, used when the list is long. */
  search: string;
  disabled?: boolean | undefined;
  every?: EveryChoice | undefined;
  onChange: (chosen: string[]) => void;
}) {
  const field = useId();
  const [query, setQuery] = useState("");
  const lost = chosen.filter((id) => !choices.some((choice) => choice.id === id));
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => needle ? choices.filter((choice) => `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(needle)) : choices, [choices, needle]);
  const flip = (id: string, on: boolean) => onChange(on ? [...chosen, id] : chosen.filter((key) => key !== id));
  const all = every?.on === true;
  const count = all ? every.label : `${String(chosen.length)} of ${String(choices.length + lost.length)}`;
  return <fieldset className="choice-list" disabled={disabled}>
    <legend className="choice-list-legend">{legend}<span className="choice-list-count">{count}</span></legend>
    {every ? <label className="choice-list-row" data-every>
      <input type="checkbox" className="choice-list-box" checked={all} onChange={(event) => every.onChange(event.target.checked)} />
      <span className="choice-list-label">{every.label}</span>
      {every.detail ? <span className="choice-list-wrap">{every.detail}</span> : null}
    </label> : null}
    {choices.length >= SEARCH_FROM ? <div className="choice-list-search">
      <SearchIcon aria-hidden size={14} />
      <input id={field} type="search" className="choice-list-query" aria-label={search} placeholder={search} value={query}
        autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
    </div> : null}
    <ul className="choice-list-rows">
      {lost.map((id) => <li key={id}><label className="choice-list-row" data-missing>
        <input type="checkbox" className="choice-list-box" checked onChange={() => flip(id, false)} />
        <span className="choice-list-label">{missing}</span><span className="choice-list-detail">{id}</span>
      </label></li>)}
      {shown.map((choice) => <li key={choice.id}><label className="choice-list-row" title={choice.detail} data-held={all || undefined}>
        <input type="checkbox" className="choice-list-box" checked={all || chosen.includes(choice.id)} disabled={all}
          onChange={(event) => flip(choice.id, event.target.checked)} />
        <span className="choice-list-label">{choice.label}</span>
        {choice.detail ? <span className="choice-list-detail">{choice.detail}</span> : null}
      </label></li>)}
    </ul>
    {needle && shown.length === 0 ? <p className="choice-list-none" role="status">Nothing matches “{query.trim()}”.</p> : null}
  </fieldset>;
}
