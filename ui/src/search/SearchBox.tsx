import type { KeyboardEvent, Ref } from "react";
import { SearchField } from "../ui/SearchField";
import { queryMode } from "./searchModel";

/** The keys that reach the search box from anywhere on the page (see `searchShortcut`). */
export const SEARCH_KEYS = "Control+K Meta+K /";

/**
 * The search box at the top of the session list. A short query narrows the
 * list by title and says how to search messages; a longer one searches them.
 */
export function SearchBox({ query, busy, onQuery, onClear, inputRef, onKeyDown }: {
  query: string; busy: boolean;
  onQuery: (query: string) => void; onClear: () => void;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
}) {
  return <SearchField label="Search sessions" value={query} onChange={onQuery} busy={busy} busyLabel="Searching messages"
    clear={{ label: "Clear search", onClear }} keyShortcuts={SEARCH_KEYS} inputRef={inputRef} onKeyDown={onKeyDown}
    hint={queryMode(query) === "title" ? "Type 3 or more characters to search messages" : undefined} />;
}
