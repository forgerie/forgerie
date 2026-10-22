// Dev-only, network-free preview of backlog suggestions in a chat: the real thread, the real cards, the header's
// count and its sheet, all on the production store with an in-memory stand-in for the server's routes.
// ?scenario= suggested | github | filed | started | many | duplicate | failed | azure | sheet | long. Nothing reaches Pi.
import { useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../src/transcript";
import { artifactSuggestion } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import type { ToolArtifactView } from "../src/ui/Messages";
import { createSuggestionsStore } from "../src/backlog/suggestions/suggestionsStore";
import type { Suggestion } from "../src/backlog/suggestions/suggestionsApi";
import { memoryServer } from "../src/backlog/suggestions/fixtures/memoryApi";
import { SuggestionCard } from "../src/backlog/suggestions/SuggestionCard";
import { SuggestionsOpener } from "../src/backlog/suggestions/SuggestionsOpener";
import { SuggestionsSheet } from "../src/backlog/suggestions/SuggestionsSheet";
import { cardInputs } from "../src/backlog/suggestions/cardInputs";
import { openerView } from "../src/backlog/suggestions/suggestionsModel";
import { AZURE, CHAT_MODEL, CHAT_SUGGESTIONS, CHAT_TITLE, DUPLICATE, FAILED, FILED, LONG, MODELS, OPEN, OPEN_GITHUB, SHORT, STARTED, look } from "../src/backlog/suggestions/fixtures/suggestions";
import "../src/ui/theme.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "suggested";
const RECORDS: Record<string, Suggestion[]> = {
  suggested: [OPEN], github: [OPEN_GITHUB], filed: [FILED], started: [STARTED], duplicate: [DUPLICATE], failed: [FAILED], azure: [AZURE],
  many: CHAT_SUGGESTIONS, sheet: CHAT_SUGGESTIONS, long: [LONG, SHORT],
};
const records = RECORDS[scenario] ?? [OPEN];

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const tool = (id: string, name: string, args: unknown, state: ToolState): TranscriptPart => ({ type: "tool", id, name, args, state });
const suggestCall = (record: Suggestion): TranscriptMessage => ({ id: `call-${record.id}`, role: "assistant", parts: [
  tool(`tool-${record.id}`, "suggest_backlog", { title: record.title }, { type: "done", output: "Suggested.", isError: false,
    suggestion: { suggestionId: record.id, destination: record.destination } }),
] });
const opening: TranscriptMessage[] = [
  say("u1", "user", "After my connection dropped, the tool row in the reply stayed on “running”. Find out why and fix it."),
  { id: "a1", role: "assistant", parts: [
    { type: "text", text: "I'll read the relay and its tests first." },
    tool("t1", "read", { path: "src/server/sessions/streamRelay.ts" }, { type: "done", output: "…", isError: false }),
    tool("t2", "bash", { command: "npm test -- streamRelay" }, { type: "done", output: "…", isError: false }),
    { type: "text", text: "Found it. When the provider closes the stream before `message.end`, the relay never sends `tool.end`, so the row waits forever. I now close every open tool row when the stream ends early.\n\nThe reply itself also stops with no retry. That is a separate change, so I put it up as a backlog suggestion instead of doing it here." },
  ] },
];
const messages: TranscriptMessage[] = [...opening, ...[...records].reverse().map(suggestCall),
  say("a2", "assistant", "Back to the fix: the test for the stopped row is next.")];

function Preview() {
  const [store] = useState(() => {
    const created = createSuggestionsStore(memoryServer(records, 600).api, () => ({ sessionId: "s-chat" }));
    void created.refresh();
    return created;
  });
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [sheet, setSheet] = useState(scenario === "sheet");
  const [said, setSaid] = useState<string>();
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {} });
  const links = useMemo(() => ({ look, openSession: (id: string) => setSaid(`Opened ${id}`), openLink: () => undefined, copy: async () => true }), []);
  const toolArtifact = useMemo<ToolArtifactView>(() => (artifact) => {
    const reference = artifactSuggestion(artifact);
    if (!reference) return undefined;
    queueMicrotask(() => store.want(reference.suggestionId));
    return <div data-suggestion={reference.suggestionId}><SuggestionCard {...cardInputs({ reference, view, store, links, chat: { model: CHAT_MODEL, thinkingLevel: "high" },
      knownModels: MODELS, listModels: async () => MODELS, now: Date.parse("2026-10-21T16:58:00Z") })} /></div>;
  }, [store, view, links]);
  const list = view.suggestions ?? [];
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name={said ?? CHAT_TITLE} actions={list.length ? <SuggestionsOpener {...openerView(list, look)} onOpen={() => setSheet(true)} /> : null}>
      <Thread toolArtifact={toolArtifact} shell={{ availability: { type: "ready" }, onRun: async () => {} }}
        model={{ model: CHAT_MODEL, thinkingLevel: "high", disabled: false, listModels: async () => MODELS, listThinkingLevels: async () => ["low", "high"],
          onModel: async () => {}, onThinkingLevel: async () => {} }} />
      {sheet && <SuggestionsSheet suggestions={view.suggestions} readError={view.readError} pending={view.pending} problems={view.problems} drafts={view.drafts}
        look={look} knownModels={MODELS} now={Date.parse("2026-10-21T16:58:00Z")} actions={{
          onFile: (id) => { void store.file(id); }, onFileAndAct: (id) => { void store.fileAndAct(id); }, onRestore: (id) => { void store.restore(id); },
          onShow: (id) => { setSheet(false); document.querySelector(`[data-suggestion="${id}"]`)?.scrollIntoView({ block: "center" }); },
          onOpenSession: (id) => setSaid(`Opened ${id}`), onOpenBacklog: () => setSaid("Opened the Backlog"), onRetry: () => { void store.refresh(); },
          onClose: () => setSheet(false) }} />}
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
