import { useState, type ReactNode } from "react";
import type { SessionModel } from "../../contracts";
import type { SessionLook } from "../backlogModel";
import { SheetDialog } from "../../ui/SheetDialog";
import { RecordGroup } from "../../ui/RecordGroup";
import { PendingRow } from "../../ui/PendingRow";
import { ActionFooter } from "../../ui/ActionFooter";
import { TextButton } from "../../ui/TextButton";
import { StatusRow } from "../../ui/StatusRow";
import { ReadoutLine } from "../../ui/ReadoutLine";
import { Lede } from "../../ui/Lede";
import { LoadingLines } from "../../ui/LoadingLines";
import type { Suggestion } from "./suggestionsApi";
import { agoText, backgroundOf, destinationWords, filedWords, groupsOf, modelFromSpec, modelWords, rowState, wordsOf, type SuggestionAction, type SuggestionDraft } from "./suggestionsModel";

export interface SuggestionsSheetActions {
  onFile: (id: string) => void;
  /** Files and starts a background session. The reader stays in this chat. */
  onFileAndAct: (id: string) => void;
  onRestore: (id: string) => void;
  /** Close the sheet and bring the suggestion's card into view. */
  onShow: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
  /** Opens a filed Markdown item in the chat's file reader. Absent: its path is words only. */
  onOpenFile?: ((path: string) => void) | undefined;
  onOpenBacklog?: (() => void) | undefined;
  onRetry: () => void;
  onClose: () => void;
}

type Group = "open" | "filed" | "dismissed";

/**
 * Shape: one chat's backlog suggestions, opened from the session header. Open ones first, each with its own File
 * and File and act, then what was filed (with any background session it started), then what was dismissed, with
 * Restore. A row's title brings its card into view in the chat.
 */
export function SuggestionsSheet({ suggestions, readError, pending, problems, drafts, look, knownModels = [], now, actions }: {
  suggestions: readonly Suggestion[] | undefined;
  readError?: string | undefined;
  pending: Readonly<Record<string, SuggestionAction | "dismiss" | "restore">>;
  problems: Readonly<Record<string, string>>;
  drafts: Readonly<Record<string, SuggestionDraft>>;
  look: (sessionId: string) => SessionLook | undefined;
  knownModels?: readonly SessionModel[];
  now: number;
  actions: SuggestionsSheetActions;
}) {
  const [closed, setClosed] = useState<ReadonlySet<Group>>(new Set());
  const toggle = (group: Group) => setClosed((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; });
  const groups = suggestions ? groupsOf(suggestions) : undefined;
  const subtitle = groups ? [`${String(groups.open.length)} open`, groups.filed.length ? `${String(groups.filed.length)} filed` : "",
    groups.dismissed.length ? `${String(groups.dismissed.length)} dismissed` : ""].filter(Boolean).join(", ") : undefined;
  const title = (suggestion: Suggestion) => wordsOf(suggestion, drafts[suggestion.id]).title;
  const show = (suggestion: Suggestion) => () => actions.onShow(suggestion.id);

  const openRow = (suggestion: Suggestion) => {
    const state = suggestion.state;
    const { busy, filing, problem, offer } = rowState(suggestion, pending, problems);
    const words = destinationWords(suggestion.destination);
    const detail: ReactNode = filing ? "Filing…" : problem ?? (state.kind === "duplicate"
      ? <>{suggestion.destination.provider === "github" ? "GitHub" : "The backlog"} has a close match{state.matches[0]?.number !== undefined ? <>, #{state.matches[0].number}</> : null}. Show it in the chat to decide.</>
      : <>{words.lead} <code>{words.code}</code>{words.tail ? ` ${words.tail}` : null}</>);
    return <PendingRow key={suggestion.id} title={title(suggestion)} onShow={show(suggestion)} showLabel="Show in chat" detail={detail}
      detailTone={problem !== undefined ? "bad" : undefined}
      actions={offer ? <ActionFooter actions={[{ label: "File", tone: "primary", disabled: busy, onPress: () => actions.onFile(suggestion.id) },
        { label: "File and act", disabled: busy, onPress: () => actions.onFileAndAct(suggestion.id) }]} /> : undefined} />;
  };
  const filedRow = (suggestion: Suggestion) => {
    const state = suggestion.state;
    if (state.kind !== "filed" && state.kind !== "started") return null;
    const filed = filedWords(state, suggestion.destination);
    const ago = agoText(state.at, now);
    const link = state.url ? <a href={state.url} target="_blank" rel="noreferrer">{filed.lead.replace(/^Filed as /u, "")}</a> : null;
    const launchError = state.kind === "filed" ? state.launchError : undefined;
    const run = state.kind === "started" ? backgroundOf(state.sessionId, look) : undefined;
    const problem = problems[suggestion.id];
    const filePath = state.url === undefined && state.number === undefined
      ? state.path ?? (suggestion.destination.provider === "markdown" ? suggestion.destination.path : undefined) : undefined;
    const openFile = filePath !== undefined && actions.onOpenFile ? <TextButton label="Open the file" onPress={() => actions.onOpenFile?.(filePath)} /> : null;
    const startSession = launchError?.retryable ? <TextButton label={pending[suggestion.id] === "file-and-act" ? "Starting…" : "Start session"}
      disabled={pending[suggestion.id] !== undefined} onPress={() => actions.onFileAndAct(suggestion.id)} /> : null;
    return <PendingRow key={suggestion.id} tone="quiet" title={title(suggestion)} onShow={show(suggestion)} showLabel="Show in chat"
      detail={<>
        {link ? <>Filed as {link}</> : <>{filed.lead}{filed.code ? <> <code>{filed.code}</code></> : null}</>}{filed.tail ? ` ${filed.tail}` : null}{ago ? `, ${ago}` : null}
        {launchError ? <>. The background session did not start: {launchError.message}</> : null}
        {state.decisionLogWarning ? <>. {state.decisionLogWarning}</> : null}
        {problem ? <>. {problem}</> : null}
      </>}
      actions={openFile || startSession ? <>{openFile}{startSession}</> : undefined}
      below={state.kind === "started" && run ? <StatusRow tone={run.tone} mark="block"
        name={modelWords(modelFromSpec(state.modelSpec, knownModels)) ?? "Background session"} detail={run.name} status={run.status} meta={run.time}
        go="Open" label={`Open the background session${run.name ? `, ${run.name}` : ""}`} onPress={() => actions.onOpenSession(state.sessionId)} /> : undefined} />;
  };
  const dismissedRow = (suggestion: Suggestion) => <PendingRow key={suggestion.id} tone="quiet" title={title(suggestion)} onShow={show(suggestion)} showLabel="Show in chat"
    detail={problems[suggestion.id] ?? "Dismissed"} detailTone={problems[suggestion.id] ? "bad" : undefined}
    actions={<TextButton label={pending[suggestion.id] === "restore" ? "Restoring…" : "Restore"} disabled={pending[suggestion.id] !== undefined}
      onPress={() => actions.onRestore(suggestion.id)} />} />;

  return <SheetDialog title="Backlog suggestions" subtitle={subtitle} closeLabel="Close backlog suggestions" onClose={actions.onClose}
    footer={actions.onOpenBacklog ? <ReadoutLine action={<TextButton label="Open the Backlog" onPress={actions.onOpenBacklog} />}>
      Filed items are in the Backlog, with the open suggestions from every chat.</ReadoutLine> : undefined}>
    {readError !== undefined ? <ReadoutLine action={<TextButton label="Retry" onPress={actions.onRetry} />}>Could not read this chat's suggestions. {readError}</ReadoutLine> : null}
    {!groups ? readError === undefined ? <LoadingLines label="Reading this chat's suggestions…" /> : null : <>
      {groups.open.length === 0 ? <Lede>Nothing waits to be filed. When the agent suggests an item, it shows here and in the chat.</Lede> : null}
      {groups.open.length ? <RecordGroup label="Open" count={groups.open.length} open={!closed.has("open")} onToggle={() => toggle("open")} emphasis>
        {groups.open.map(openRow)}</RecordGroup> : null}
      {groups.filed.length ? <RecordGroup label="Filed" count={groups.filed.length} open={!closed.has("filed")} onToggle={() => toggle("filed")}>
        {groups.filed.map(filedRow)}</RecordGroup> : null}
      {groups.dismissed.length ? <RecordGroup label="Dismissed" count={groups.dismissed.length} open={!closed.has("dismissed")} onToggle={() => toggle("dismissed")}>
        {groups.dismissed.map(dismissedRow)}</RecordGroup> : null}
    </>}
  </SheetDialog>;
}
