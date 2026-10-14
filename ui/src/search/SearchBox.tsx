import type { KeyboardEvent, Ref } from "react";
import { SearchField } from "../ui/SearchField";
import { queryMode } from "./searchModel";

/** The keys that reach the search box from anywhere on the page (see `searchShortcut`). */
export const SEARCH_KEYS = "Control+K Meta+K /";

/** What the box says about a query: a short one narrows the list by title, so the hint says how to search messages. */
export function searchHint(query: string): string | undefined {
  return queryMode(query) === "title" ? "Type 3 or more characters to search messages" : undefined;
}

/**
 * The search box of the session list. A short query narrows the list by title
 * and says how to search messages; a longer one searches them.
 */
export function SearchBox({ query, busy, onQuery, onClear, inputRef, onKeyDown, hintId, variant }: {
  query: string; busy: boolean;
  onQuery: (query: string) => void; onClear: () => void;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  /** The owner draws the hint (`searchHint`) under this id, such as under the header the box sits in. Without it, the hint sits under the box. */
  hintId?: string | undefined;
  variant?: "box" | "bare" | undefined;
}) {
  const hint = searchHint(query);
  return <SearchField label="Search sessions" value={query} onChange={onQuery} busy={busy} busyLabel="Searching messages"
    clear={{ label: "Clear search", onClear }} keyShortcuts={SEARCH_KEYS} inputRef={inputRef} onKeyDown={onKeyDown} variant={variant}
    hint={hintId ? undefined : hint} describedBy={hintId && hint ? hintId : undefined} />;
}
