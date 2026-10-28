import { useState } from "react";
import { Ledge } from "./Ledge";
import { LedgeStack, type LedgeStackRow } from "./LedgeStack";

export const name = "Ledge stack";
export const note = "Offers at the input: one row with its gist; two or more fold to the newest in front with edges behind; the count opens a list that scrolls in its share of the height";

const noop = () => undefined;
const more = [{ label: "Show in chat", onSelect: noop }, "separator" as const, { label: "Dismiss", onSelect: noop }];
const file = [{ label: "File", wideOnly: true, onPress: noop }, { label: "File and act", tone: "primary" as const, onPress: noop }];
const review = [{ label: "Review", tone: "primary" as const, onPress: noop }];
const ROWS: LedgeStackRow[] = [
  { key: "a", kind: "Issue", title: "Retry once when the provider stream drops before message.end", gist: "A stream that closes early ends the reply with no error.", actions: file, menu: more, onTitle: noop },
  { key: "b", kind: "Workflow", kindTone: "live", title: "Split theme.css into one file per surface", actions: review, menu: more, onTitle: noop },
  { key: "c", kind: "Backlog", title: "Give the pinned dock a height budget when the Fold is on its side", actions: file, menu: more, onTitle: noop },
  { key: "d", kind: "Issue", title: "Show the thinking level in the session picker", actions: file, menu: more, onTitle: noop },
  { key: "e", kind: "Backlog", title: "Drop OldIssueProposalLine after the next archive sweep", actions: file, menu: more, onTitle: noop },
  { key: "f", kind: "Workflow", kindTone: "live", title: "Audit every *.part.tsx for a narrow-tall state", actions: review, menu: more, onTitle: noop },
  { key: "g", kind: "Issue", title: "Count a queued compaction in the context meter", actions: file, menu: more, onTitle: noop },
  { key: "h", kind: "Backlog", title: "Say what Steer does in its tooltip, not how", actions: file, menu: more, onTitle: noop },
  { key: "i", kind: "Issue", title: "Handle ERR_HTTP2_PROTOCOL_ERROR_DURING_STREAM_RESET_AFTER_GOAWAY_FRAME_RECEIVED in streamRelay.ts", actions: file, menu: more, onTitle: noop },
];
const labels = { noun: (count: number) => count === 1 ? "proposal" : "proposals", show: (count: number) => `Show all ${String(count)} proposals`, fold: "Fold" };

function Stack({ rows, open: initial = false }: { rows: readonly LedgeStackRow[]; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return <Ledge label="Waiting at the input" open><LedgeStack rows={rows} open={open} onToggle={() => setOpen(!open)} labels={labels} /></Ledge>;
}
export default function One() {
  return <Stack rows={ROWS.slice(0, 1)} />;
}
export function Two() {
  return <Stack rows={ROWS.slice(0, 2)} />;
}
export function ThreeFolded() {
  return <Stack rows={ROWS.slice(0, 3)} />;
}
export function ThreeOpen() {
  return <Stack rows={ROWS.slice(0, 3)} open />;
}
/** More than fit: the list scrolls inside its budget, and a fade says there is more. */
export function NineOpen() {
  return <Stack rows={ROWS} open />;
}
