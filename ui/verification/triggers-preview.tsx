// The triggers screen in the app's shell, on fixture data: the real binding and views, with an in-memory trigger
// store in the HTTP client's place. No request leaves the page and nothing is intercepted.
//   ?state=list|calm|empty|off|failed-read|many|failed|missed|paused|starting|create   &sheet=open shows the session list and its footer.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/ui/AppShell";
import { Picker } from "../src/ui/Picker";
import { ToastRegion } from "../src/ui/ToastRegion";
import { DEFAULT_COLLAPSED, createLocationResolver, rows, sections } from "../src/picker/board";
import { TriggersScreen } from "../src/triggers/Triggers.binding";
import { useTriggerList } from "../src/triggers/useTriggerList";
import { triggerEntry, type TriggerPlace } from "../src/triggers/triggersModel";
import { memoryApi, memoryDirectory } from "../src/triggers/fixtures/memoryApi";
import { createTriggerMemory } from "../src/triggers/triggerMemory";
import { audit, calmList, digest, docs, emptyList, HOST_ZONE, manyList, mixedList, NOW, nightly, projects } from "../src/triggers/fixtures/triggers";
import "../src/ui/theme.css";
import "../src/ui/settings/settings.css";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "list";
const FIXTURES = { list: mixedList, calm: calmList, empty: emptyList, many: manyList, off: emptyList, "failed-read": calmList };
const lists: Record<string, typeof mixedList> = FIXTURES;
const PAGES: Record<string, TriggerPlace> = {
  failed: { view: "trigger", id: nightly.id }, missed: { view: "trigger", id: audit.id }, paused: { view: "trigger", id: docs.id },
  starting: { view: "trigger", id: digest.id }, create: { view: "create" },
};
const store = memoryApi((lists[state] ?? mixedList).triggers, { now: NOW, off: state === "off" ? "Could not open the trigger store: database is locked" : undefined });
if (state === "failed-read") store.failNext("list", new Error("Request failed: HTTP 500"));
const locate = createLocationResolver(projects, []);
const memory = createTriggerMemory();
const sessions = [
  { id: "s1", cwd: projects[0]!.path, name: "Nightly refinement · Oct 10", modified: new Date(NOW - 15 * 3_600_000).toISOString() },
  { id: "s2", cwd: projects[1]!.path, name: "Weekday triage · Oct 12", modified: new Date(NOW - 9 * 3_600_000).toISOString() },
  { id: "s3", cwd: projects[0]!.path, name: "Port the backlog view", modified: new Date(NOW - 2 * 3_600_000).toISOString() },
];

function Preview() {
  const list = useTriggerList(store.api);
  const [place, setPlace] = useState<TriggerPlace | undefined>(PAGES[state] ?? { view: "list" });
  const [open, setOpen] = useState(params.get("sheet") === "open");
  const entry = triggerEntry(list.load);
  const view = useMemo(() => {
    const all = rows({ sessions, statuses: {}, activities: {}, unread: new Set(["s2"]), locate, now: NOW });
    return { connection: { type: "ready" as const }, machines: 1, archivedCount: 0, sections: sections(all, { grouping: "state", showArchived: false, now: NOW }) };
  }, []);
  return <AppShell open={open} onOpenChange={setOpen} attention={entry.attention ? "blocked" : undefined}
    picker={() => <Picker view={view} prefs={{ grouping: "state", showArchived: false, allPinned: false, collapsed: DEFAULT_COLLAPSED }} onPrefs={() => undefined}
      actions={{ onSelect: () => undefined, onRetry: () => undefined, onNew: () => undefined, onClose: () => setOpen(false),
        onBacklog: () => undefined, backlogCount: 12, onSettings: () => undefined, onFullscreen: () => undefined, fullscreen: false,
        onTriggers: () => { setPlace({ view: "list" }); setOpen(false); }, triggersOpen: place !== undefined, triggers: { title: entry.title, chip: entry.chip } }} />}
    thread={place ? <TriggersScreen list={list} api={store.api} directory={memoryDirectory} memory={memory} now={() => NOW} zone={HOST_ZONE} locale="en-US"
      args={{ place, onPlace: (next) => setPlace(next), onOpenSession: () => undefined, sessionName: () => "Lockfile review" }} />
      : <div className="thread-empty" />} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(<><Preview /><ToastRegion /></>);
