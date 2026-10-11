import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { SearchResults } from "./SearchResults";
import type { SearchHit } from "./searchApi";
import type { ResultsView } from "./searchModel";
import { HITS, MORE_HITS, NOW, QUERY, where } from "./fixtures/hits";

export const name = "Search results";
export const note = "Session search hits in the session list's place, and every state the search can be in";
export const checks = {
  default: {
    "a hit opens its session": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /Fix the deploy script on zao/ }));
      expect(canvas.getByText("Opened Fix the deploy script on zao")).toBeVisible();
    },
  },
  ShowMore: {
    "Show more adds the next page": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Show more" }));
      expect(canvas.getByText("Read the deploy logs")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = {
  default: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "default" }, { part: "src/ui/HitRow.molecule.part.tsx", state: "default" }],
  Loading: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "Loading" }],
  Busy: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "Busy" }],
  Empty: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "Empty" }],
  Building: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "Gathering" }],
  Failed: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "Failed" }],
  ShowMore: [{ part: "src/ui/ResultList.molecule.part.tsx", state: "More" }],
};

const hits = (extra: Partial<Extract<ResultsView, { type: "hits" }>> = {}): ResultsView =>
  ({ type: "hits", query: QUERY, hits: HITS, busy: false, more: "none", ...extra });
function Stateful({ initial }: { initial: ResultsView }) {
  const [view, setView] = useState(initial);
  const [opened, setOpened] = useState("Nothing opened");
  const open = (hit: SearchHit) => setOpened(`Opened ${hit.title || "Untitled session"}`);
  const more = () => {
    if (view.type !== "hits") return;
    setView({ ...view, hits: [...view.hits, ...MORE_HITS], more: "none" });
  };
  return <>
    <SearchResults view={view} now={NOW} where={where} onOpen={open} onMore={more}
      onRetry={() => setView(hits())} />
    <p aria-live="polite">{opened}</p>
  </>;
}

export default function Hits() { return <Stateful initial={hits()} />; }
/** The first query, before any answer: skeleton rows. */
export function Loading() { return <Stateful initial={{ type: "loading" }} />; }
/** A later keystroke: the last hits stay under a busy mark. */
export function Busy() { return <Stateful initial={hits({ busy: true })} />; }
export function Empty() { return <Stateful initial={hits({ query: "kubernetes", hits: [] })} />; }
/** The index is still being built: the progress line, and the hits so far. */
export function Building() {
  return <Stateful initial={hits({ hits: HITS.slice(0, 2), progress: { text: "Indexing 4,210 of 13,719 sessions — newer sessions first", value: 4210, max: 13_719 } })} />;
}
export function BuildingEmpty() {
  return <Stateful initial={hits({ query: "kubernetes", hits: [], progress: { text: "Indexing 812 of 13,719 sessions — newer sessions first", value: 812, max: 13_719 } })} />;
}
/** The server could not search. Retry asks again; the typed query stays in the box. */
export function Failed() { return <Stateful initial={{ type: "failed", message: "The search index is not available. sessiond may be restarting." }} />; }
/** A refresh failed while hits stay on screen. */
export function ErrorWithHits() {
  return <Stateful initial={hits({ error: "Could not reach the server. Check the connection, then try again." })} />;
}
export function ShowMore() { return <Stateful initial={hits({ more: "idle" })} />; }
export function MoreLoading() { return <Stateful initial={hits({ more: "loading" })} />; }
export function MoreFailed() { return <Stateful initial={hits({ more: "failed" })} />; }
/** The chosen group has no project folder this machine knows, so nothing was asked. */
export function NoFolders() { return <Stateful initial={{ type: "no-folders", query: QUERY }} />; }
/** A short query narrows the list by title, and no title matched. */
export function TitlesNone() { return <Stateful initial={{ type: "titles-none", query: "zq" }} />; }
