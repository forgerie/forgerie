import { useState } from "react";
import { Picker, type PickerSearch, type PickerView } from "./Picker";
import { SearchField } from "./SearchField";
import type { Row, Section } from "../picker/board";
import type { PickerPrefs } from "../picker/prefs";

export const name = "Picker";
export const note = "The session list: triage groups, each row's place, age, and live work";

const location = { projectKey: "/code/forgerie", project: "forgerie" };
const row = (id: string, name: string, state: Row["state"], time: string, work: Partial<Pick<Row, "agents" | "processes" | "flagged">> = {}): Row => ({
  session: { id, cwd: "/code/forgerie", name, modified: "2026-10-13T12:00:00.000Z" }, state, group: state === "open" ? "open" : state, location, time,
  working: state === "working", busy: state === "working", agents: 0, processes: 0, flagged: 0, ...work,
});
/** A session asks; one works with two agents and a flagged guess; one has only flagged guesses, and stays in its age band. */
const SECTIONS: Section[] = [
  { key: "blocked", label: "Needs your response", kind: "blocked", rows: [row("ask", "Release notes for 1.2", "blocked", "3m")] },
  { key: "working", label: "Working", kind: "working", rows: [row("run", "Export run history as CSV", "working", "1m", { agents: 2, flagged: 1 })] },
  { key: "hour", label: "Last hour", kind: "band", rows: [
    row("guessed", "Port the settings page to the shared store", "open", "20m", { flagged: 3 }),
    row("idle", "Why does the dock flicker on resume?", "open", "40m"),
  ] },
];
/** Attention hints: two rows a hint moved to Needs your response (one urgent), beside one the agent asked from; an unread reply with a kind. */
const HINTED: Section[] = [
  { key: "blocked", label: "Needs your response", kind: "blocked", rows: [
    { ...row("pick", "Pick a retry policy for the export queue", "blocked", "2m"), likelyNeedsYou: true, attentionKind: "decision", urgency: "high" },
    { ...row("port", "Review the settings store port", "blocked", "6m"), likelyNeedsYou: true, attentionKind: "review" },
    { ...row("guess", "Speed up session listing on a busy machine", "blocked", "11m"), likelyNeedsYou: true },
    row("ask", "Release notes for 1.2", "blocked", "14m"),
  ] },
  { key: "unread", label: "Unread", kind: "unread", rows: [{ ...row("bump", "Bump typebox and re-run the schema tests", "unread", "20m"), attentionKind: "done" }] },
];
const PREFS: PickerPrefs = { grouping: "state", showArchived: false, allPinned: false, collapsed: new Set(["week", "month", "older"]) };

/** The list with its own prefs, selection, and search, as the shell's binding keeps them. */
function Stateful({ initialQuery, all = SECTIONS }: { initialQuery?: string; all?: Section[] }) {
  const [prefs, setPrefs] = useState(PREFS);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [open, setOpen] = useState(false);
  const needle = query.trim().toLowerCase();
  const sections = needle ? all.map((section) => ({ ...section, rows: section.rows.filter((one) => one.session.name?.toLowerCase().includes(needle)) }))
    .filter((section) => section.rows.length > 0) : all;
  const view: PickerView = { connection: { type: "ready" }, machines: 1, selectedId: selected, archivedCount: 0, sections };
  const search: PickerSearch = {
    field: <SearchField label="Search sessions" value={query} onChange={setQuery} variant="bare" describedBy="picker-part-hint"
      clear={{ label: "Clear search", onClear: () => setQuery("") }} />,
    query, open, keys: "Control+K Meta+K /",
    onOpen: () => setOpen(true), onClose: () => { setQuery(""); setOpen(false); },
    hint: needle && needle.length < 3 ? { id: "picker-part-hint", text: "Type 3 or more characters to search messages" } : undefined,
  };
  return <Picker view={view} prefs={prefs} onPrefs={setPrefs} search={search} narrowed={needle !== ""}
    actions={{ onSelect: (picked) => setSelected(picked.session.id), onRetry: () => {}, onNew: () => {}, onClose: () => {} }} />;
}
/** Search and New session are icons in the header row, so the first group starts under it. */
export default function Triage() {
  return <Stateful />;
}
/** Search open: the field takes the header's place, and a short query narrows the list by title. */
export function Searching() {
  return <Stateful initialQuery="po" />;
}
/** Hints mark a guessed row with a hollow square and a muted word, apart from the filled square of a row the agent asked from. */
export function AttentionHints() {
  return <Stateful all={HINTED} />;
}
