import type { Ref } from "react";
import { shortAge } from "../picker/board";
import { HitRow } from "../ui/HitRow";
import { ResultList } from "../ui/ResultList";
import type { SearchHit } from "./searchApi";
import { moreMatches, type ResultsView } from "./searchModel";

const quoted = (query: string) => `“${query}”`;

/**
 * What a search found, in the session list's place: the hits, newest session
 * first, or the state the search is in. `where` names a session's project the
 * way the list does.
 */
export function SearchResults({ view, now, where, onOpen, onRetry, onMore, listRef }: {
  view: ResultsView; now: number;
  where: (cwd: string) => string;
  onOpen: (hit: SearchHit) => void; onRetry: () => void; onMore: () => void;
  listRef?: Ref<HTMLDivElement> | undefined;
}) {
  if (view.type === "loading") return <ResultList label="Searching sessions" rows={[]} loading rootRef={listRef} />;
  if (view.type === "failed") return <ResultList label="Search sessions" rows={[]} rootRef={listRef}
    alert={{ text: view.message, action: { label: "Retry", onPress: onRetry } }} />;
  if (view.type === "titles-none") return <ResultList label="Sessions" rows={[]} rootRef={listRef}
    empty={<p>No session titles match {quoted(view.query)}</p>} />;
  if (view.type === "no-folders") return <ResultList label={`Sessions matching ${quoted(view.query)}`} rows={[]} rootRef={listRef}
    empty={<>
      <p>No sessions match {quoted(view.query)}</p>
      <p>The chosen project group has no project folder on this machine, so there is nothing to search. Show all projects, or add a project to the group.</p>
    </>} />;
  const rows = view.hits.map((hit) => ({ key: hit.sessionId, node: <HitRow title={hit.title || "Untitled session"} untitled={!hit.title}
    where={where(hit.cwd)} time={shortAge(hit.modified, now)} timeTitle={new Date(hit.modified).toLocaleString()}
    tags={[...(hit.archived ? ["Archived"] : []), ...(hit.offBranch ? ["Other branch"] : [])]}
    speaker={hit.passage.role === "user" ? "You" : undefined} passage={hit.passage.text} marks={hit.passage.marks}
    footnote={hit.otherMatches > 0 ? moreMatches(hit.otherMatches) : undefined} onPress={() => onOpen(hit)} /> }));
  const more = view.more === "none" ? undefined
    : view.more === "loading" ? { label: "Loading more…", busy: true, onPress: onMore }
    : view.more === "failed" ? { label: "Try again", note: "Could not load more sessions.", onPress: onMore }
    : { label: "Show more", onPress: onMore };
  return <ResultList label={`Sessions matching ${quoted(view.query)}`} rows={rows} busy={view.busy} progress={view.progress} more={more} rootRef={listRef}
    alert={view.error === undefined ? undefined : { text: view.error, action: { label: "Retry", onPress: onRetry } }}
    empty={<>
      <p>No sessions match {quoted(view.query)}</p>
      {view.progress ? <p>Sessions still being indexed may match once they are read.</p> : null}
    </>} />;
}
