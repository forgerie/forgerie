// The triggers screen in the app's shell, on fixture data: the real binding and views, with an in-memory trigger
// store in the HTTP client's place. No request leaves the page and nothing is intercepted.
//   ?state=list|calm|empty|off|failed-read|loading|many|failed|missed|paused|starting|create|unknown|conflict|edited|long
//          |days-problem|input-problem|create-in-project|several|everywhere|not-shared
//   &sheet=open shows the session list and its footer. &view=session shows a session in the thread's place instead of
//   the triggers, with the list closed: the opener's dot is then the only sign of a trigger problem.
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
import {
  audit, calmList, digest, docs, emptyList, everywhere, FORGERIE, HOST_ZONE, manyList, mixedList, NOW, nightly, PI_MONO, projects, spreadNotes, triage,
} from "../src/triggers/fixtures/triggers";
import { draftOf, emptyDraft, type TriggerDraft } from "../src/triggers/triggerDraft";
import type { Trigger } from "@shared/triggers";
import { SessionFrame } from "../src/ui/SessionFrame";
import "../src/ui/theme.css";
import "../src/ui/settings/settings.css";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "list";
/** Nightly refinement with the 50 runs Forgerie keeps, so its page offers Show all 50. */
const long: Trigger = { ...nightly, history: Array.from({ length: 50 }, (_, index) => {
  const fire = nightly.history[index % nightly.history.length]!;
  return { ...fire, occurrence: fire.occurrence - Math.floor(index / nightly.history.length) * 7 * 86_400_000, requestId: `${fire.requestId}-${String(index)}` };
}) };
const FIXTURES = { list: mixedList, calm: calmList, empty: emptyList, many: manyList, off: mixedList, "failed-read": calmList,
  long: { ...mixedList, triggers: [long, triage] } };
const lists: Record<string, typeof mixedList> = FIXTURES;
const PAGES: Record<string, TriggerPlace> = {
  failed: { view: "trigger", id: nightly.id }, missed: { view: "trigger", id: audit.id }, paused: { view: "trigger", id: docs.id },
  starting: { view: "trigger", id: digest.id }, create: { view: "create" }, unknown: { view: "trigger", id: "gone" },
  conflict: { view: "trigger", id: triage.id }, edited: { view: "trigger", id: triage.id }, long: { view: "trigger", id: nightly.id },
  "days-problem": { view: "create" }, "input-problem": { view: "create" }, "create-in-project": { view: "create" },
  several: { view: "trigger", id: spreadNotes.id }, everywhere: { view: "trigger", id: everywhere.id }, "not-shared": { view: "trigger", id: nightly.id },
};
const store = memoryApi((lists[state] ?? mixedList).triggers, { now: NOW, off: state === "off" ? "Could not open the trigger store: database is locked" : undefined });
if (state === "failed-read") store.failNext("list", new Error("Request failed: HTTP 500"));
// The first read never answers, so the list stays at "Reading triggers…".
const api = state === "loading" ? { ...store.api, list: () => new Promise<never>(() => undefined) } : store.api;
const locate = createLocationResolver(projects, []);
const memory = createTriggerMemory();
/** Drafts the page finds on opening, as if the reader had left them there. */
const seed = (key: string, draft: TriggerDraft, start: TriggerDraft, revision = 12) => memory.drafts.set(key, { draft, start, revision, refused: false });
const fresh = { ...emptyDraft(HOST_ZONE), zoneChosen: true };
if (state === "conflict") seed(`trigger:${triage.id}`, { ...draftOf(triage), name: "Weekday issue triage" }, { ...draftOf(triage), at: "08:00" }, 11);
if (state === "edited") seed(`trigger:${triage.id}`, { ...draftOf(triage), name: "Weekday issue triage", at: "08:30" }, draftOf(triage));
if (state === "days-problem") seed("create", { ...fresh, name: "Nightly docs", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "docs-sweep", repeat: "days", days: [], at: "02:30" }, fresh);
if (state === "input-problem") seed("create", { ...fresh, name: "Nightly refinement 2", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "refine-backlog" }, fresh);
if (state === "create-in-project") seed("create", { ...fresh, targets: { kind: "projects", cwds: [FORGERIE] } }, fresh);
if (state === "not-shared") seed(`trigger:${nightly.id}`, { ...draftOf(nightly), targets: { kind: "projects", cwds: [FORGERIE, PI_MONO] } }, draftOf(nightly));
const sessions = [
  { id: "s1", cwd: projects[0]!.path, name: "Nightly refinement · Oct 10", modified: new Date(NOW - 15 * 3_600_000).toISOString() },
  { id: "s2", cwd: projects[1]!.path, name: "Weekday triage · Oct 12", modified: new Date(NOW - 9 * 3_600_000).toISOString() },
  { id: "s3", cwd: projects[0]!.path, name: "Port the backlog view", modified: new Date(NOW - 2 * 3_600_000).toISOString() },
];

function Preview() {
  const list = useTriggerList(api);
  const [place, setPlace] = useState<TriggerPlace | undefined>(params.get("view") === "session" ? undefined : PAGES[state] ?? { view: "list" });
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
    thread={place ? <TriggersScreen list={list} api={api} directory={memoryDirectory} memory={memory} now={() => NOW} zone={HOST_ZONE} locale="en-US"
      args={{ place, onPlace: (next) => setPlace(next), onOpenSession: () => undefined, sessionName: () => "Lockfile review" }} />
      : <SessionFrame name="Port the backlog view"><div className="thread-empty" /></SessionFrame>} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(<><Preview /><ToastRegion /></>);
