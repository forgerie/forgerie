import { useState } from "react";
import { Picker, type PickerSearch, type PickerView } from "./Picker";
import { SearchField } from "./SearchField";
import type { Row, Section } from "../picker/board";
import type { PickerPrefs } from "../picker/prefs";

export const name = "Picker";
export const note = "The session list: triage groups, each row's place, age, and live work";

const location = { projectKey: "/code/forgerie", project: "forgerie" };
const row = (id: string, name: string, state: Row["state"], time: string, work: Partial<Pick<Row, "agents" | "processes" | "flagged" | "workflow">> = {}): Row => ({
  session: { id, cwd: "/code/forgerie", name, modified: "2026-10-13T12:00:00.000Z" }, state, group: state === "open" ? "open" : state, location, time,
  working: state === "working", busy: state === "working", agents: 0, processes: 0, flagged: 0, ...work,
});
type Workflow = NonNullable<Row["workflow"]>;
type Stage = Workflow["stages"][number];
/** A seven-stage route: `done` before `at`, `at` at index `index`, `next` after. */
const route = (at: Stage, index: number): Stage[] => Array.from({ length: 7 }, (_, stage) => stage < index ? "done" : stage === index ? at : "next");
const run = (stages: Stage[], stage: string, waiting = 0, name = "Design, build, review"): Workflow => ({ name, stages, stage, waiting });
/** The behaviour table's cases, one section each. A `Stage at work` row keeps its agent count on the second line. */
const RUNS = {
  working: [row("raid", "Thunderbolt RAID health check", "working", "36m", { agents: 1, workflow: run(route("working", 3), "Independently review") })],
  waiting: [row("backlog", "Backlog not working", "blocked", "34m", { workflow: run(route("waiting", 5), "Approve landing", 1) })],
  failed: [row("acq", "Steam acquisition revival", "unread", "38m", { workflow: run(route("failed", 2), "Implement and test") })],
  many: [row("modules", "Review every module", "working", "1h", { agents: 4, processes: 1,
    workflow: run([...Array<Stage>(34).fill("done"), "working", "working", ...Array<Stage>(4).fill("next")], "Review the queue module") })],
  none: [row("steam", "steam", "working", "27m", { agents: 1, flagged: 1 }), row("raid", "Thunderbolt RAID health check", "working", "36m", { agents: 1, workflow: run(route("working", 3), "Independently review") })],
  long: [row("land", "Land the picker's stage line", "blocked", "2m", { workflow: run(route("waiting", 6), "Rebase, verify, and fast-forward onto main after the final combined checks", 2) }),
    row("word", "Rename the export job", "working", "9m", { workflow: run(route("working", 1), "Pneumonoultramicroscopicsilicovolcanoconiosis_check_without_a_break_point") })],
  prose: [row("notes", "Release notes for 1.2", "blocked", "3m", { workflow: run([], "", 1, "Write and review") }), row("draft", "Draft the 1.3 plan", "working", "12m", { workflow: run([], "", 0, "Write and review") })],
} satisfies Record<string, Row[]>;
const section = (key: string, label: string, kind: Section["kind"], rows: Row[]): Section => ({ key, label, kind, rows });
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
function Stateful({ initialQuery, all = SECTIONS, initialSelected }: { initialQuery?: string; all?: Section[]; initialSelected?: string }) {
  const [prefs, setPrefs] = useState(PREFS);
  const [selected, setSelected] = useState<string | undefined>(initialSelected);
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

/**
 * The list docked in the shell at its two bounds, 18rem and 15rem (`--picker-width: clamp(15rem, 22%, 18rem)`), the
 * first row selected so its ⋯ shows. The 15rem list docks in the 18rem shell's main column, so both stand side by side
 * in the shell's own chrome.
 */
function AtBothWidths({ sections }: { sections: Section[] }) {
  const first = sections[0]?.rows[0]?.session.id;
  return <div className="app-shell" data-layout="docked" style={{ "--picker-width": "18rem" }}>
    <aside className="app-picker"><Stateful all={sections} initialSelected={first} /></aside>
    <div className="app-shell" data-layout="docked" style={{ "--picker-width": "15rem" }}>
      <aside className="app-picker"><Stateful all={sections} initialSelected={first} /></aside>
    </div>
  </div>;
}
/** A run with a stage at work: the strip's grid under the place, its working block blinking, the stage's name muted. The agent count stays on the second line. */
export function StageAtWork() {
  return <AtBothWidths sections={[section("working", "Working", "working", RUNS.working)]} />;
}
/** A stop waits on the reader: the name takes the live ink and a pill counts what waits. Selected, the ⋯ clears the pill. */
export function StopWaiting() {
  return <AtBothWidths sections={[section("blocked", "Needs your response", "blocked", RUNS.waiting)]} />;
}
/** A failed stage: its block and the name in the bad ink. */
export function StageFailed() {
  return <AtBothWidths sections={[section("unread", "Unread", "unread", RUNS.failed)]} />;
}
/** Forty stages: the leading ones fold to `+n` so the grid keeps the strip's share of the line. */
export function ManyStages() {
  return <AtBothWidths sections={[section("working", "Working", "working", RUNS.many)]} />;
}
/** A row without a run keeps its two lines and 44px beside one that grew a third. */
export function NoRun() {
  return <AtBothWidths sections={[section("working", "Working", "working", RUNS.none)]} />;
}
/** A long stage name ends in an ellipsis, with the full name in its title; the pill stays. One name has no break point. */
export function LongStageName() {
  return <AtBothWidths sections={[section("blocked", "Needs your response", "blocked", RUNS.long)]} />;
}
/** A prose-only run has no stages: the workflow's name stands where the stage's would, with the pill and no grid. */
export function ProseOnlyRun() {
  return <AtBothWidths sections={[section("blocked", "Needs your response", "blocked", RUNS.prose)]} />;
}
/** Every case in one list, as the inbox shows them side by side. */
export function Runs() {
  return <AtBothWidths sections={[
    section("blocked", "Needs your response", "blocked", [...RUNS.waiting, ...RUNS.prose.slice(0, 1)]),
    section("working", "Working", "working", [...RUNS.working, ...RUNS.many, ...RUNS.none.slice(0, 1)]),
    section("unread", "Unread", "unread", RUNS.failed),
  ]} />;
}
