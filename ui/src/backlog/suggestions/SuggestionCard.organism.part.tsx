import { useState } from "react";
import { SuggestionCard, type CardPress } from "./SuggestionCard";
import type { Suggestion, SuggestionModel } from "./suggestionsApi";
import { backgroundOf, launchModel, markdownOf, type SuggestionAction, type SuggestionDraft } from "./suggestionsModel";
import { answer } from "./fixtures/serverLike";
import { AZURE, CHAT_MODEL, DISMISSED, DUPLICATE, FAILED, FAILED_FINAL, FILED, FILED_GITHUB, FILING, LAUNCH_ERROR, LAUNCH_ERROR_LOGGED, LONG, MODELS, NO_DEFAULT, NOW,
  OPEN, OPEN_GITHUB, SHORT, STARTED, STARTED_DONE, STARTED_NEEDS, look } from "./fixtures/suggestions";

export const name = "Backlog suggestion card";
export const note = "One backlog suggestion in the chat, in every state its record can reach; File and act never leaves the chat";

/** The card around a record that answers each press the way the server does, a moment later. */
function Stateful({ initial, read = "ready", hold = false, editing = false, words }: { initial: Suggestion | undefined; read?: "loading" | "missing" | "ready"; hold?: boolean;
  editing?: boolean; words?: SuggestionDraft }) {
  const [record, setRecord] = useState(initial);
  const [press, setPress] = useState<CardPress>();
  const [last, setLast] = useState<SuggestionAction>();
  const [draft, setDraft] = useState<SuggestionDraft | undefined>(words);
  const [model, setModel] = useState<SuggestionModel>();
  const [opened, setOpened] = useState<string>();
  const launch = record ? launchModel(record, model, { model: CHAT_MODEL }, MODELS) : { source: "chat" as const };
  const act = (kind: CardPress) => {
    if (!record) return;
    setPress(kind);
    if (kind === "file" || kind === "file-and-act") setLast(kind);
    // A press that stays in flight shows its waiting state.
    if (hold) return;
    setTimeout(() => {
      setRecord(answer(record, kind, { modelSpec: model?.modelSpec, ...(draft ?? {}) }));
      setPress(undefined); setDraft(undefined);
    }, 400);
  };
  return <>
    <SuggestionCard suggestion={record} destination={initial?.destination} read={read === "ready" ? { type: "ready" } : { type: read }} press={press} draft={draft} last={last}
      launch={launch} background={record?.state.kind === "started" ? backgroundOf(record.state.sessionId, look) : undefined}
      initialEditing={editing} knownModels={MODELS} listModels={async () => MODELS} now={NOW} markdown={record ? markdownOf(record, draft) : ""}
      actions={{ onFile: () => act("file"), onFileAndAct: () => act("file-and-act"), onDismiss: () => act("dismiss"), onRestore: () => act("restore"),
        onDraft: setDraft, onModel: setModel, onOpenSession: setOpened, onOpenLink: () => undefined, onCopy: async () => true, onRetryRead: () => undefined }} />
    {opened ? <p>Opened {opened}</p> : null}
  </>;
}

export default function Open() { return <Stateful initial={OPEN} />; }
export function Editing() {
  return <Stateful initial={OPEN} editing words={{ title: "Retry once when a provider stream closes before message.end", body: OPEN.body.replace("say so in the reply", "show the failure under the reply") }} />;
}
export function OpenGitHub() { return <Stateful initial={OPEN_GITHUB} />; }
export function ChatModel() { return <Stateful initial={NO_DEFAULT} />; }
export function Filing() { return <Stateful initial={FILING} hold />; }
export function Filed() { return <Stateful initial={FILED} />; }
export function FiledGitHub() { return <Stateful initial={FILED_GITHUB} />; }
export function Started() { return <Stateful initial={STARTED} />; }
export function StartedNeedsYou() { return <Stateful initial={STARTED_NEEDS} />; }
export function StartedDone() { return <Stateful initial={STARTED_DONE} />; }
export function LaunchFailed() { return <Stateful initial={LAUNCH_ERROR} />; }
export function LaunchFailedUnrecorded() { return <Stateful initial={LAUNCH_ERROR_LOGGED} />; }
export function Duplicate() { return <Stateful initial={DUPLICATE} />; }
export function Failed() { return <Stateful initial={FAILED} />; }
export function FailedFinal() { return <Stateful initial={FAILED_FINAL} />; }
export function AzureNote() { return <Stateful initial={AZURE} />; }
export function Dismissed() { return <Stateful initial={DISMISSED} />; }
export function Reading() { return <Stateful initial={undefined} read="loading" />; }
export function Missing() { return <Stateful initial={undefined} read="missing" />; }
export function LongWords() { return <Stateful initial={LONG} />; }
export function NoContext() { return <Stateful initial={SHORT} />; }
