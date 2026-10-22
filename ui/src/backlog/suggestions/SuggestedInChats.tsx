import { useState } from "react";
import { RecordGroup } from "../../ui/RecordGroup";
import { PendingRow } from "../../ui/PendingRow";
import { ActionFooter } from "../../ui/ActionFooter";
import { ReadoutLine } from "../../ui/ReadoutLine";
import { TextButton } from "../../ui/TextButton";
import type { Suggestion } from "./suggestionsApi";
import { agoText, destinationWords, rowState, wordsOf, type SuggestionAction, type SuggestionDraft } from "./suggestionsModel";

export interface SuggestedInChatsActions {
  onFile: (id: string) => void;
  /** Files and starts a background session. The Backlog view stays open. */
  onFileAndAct: (id: string) => void;
  /** Open the chat the suggestion came from, with its card in view. */
  onShow: (suggestion: Suggestion) => void;
  onRetry: () => void;
}

/**
 * Shape: the Backlog view's group of suggestions that wait to be filed, from every chat. Each row says where it
 * goes and which chat it came from, with File, File and act, and Show in chat. A filed item leaves the group: it
 * is in its project's backlog, and a background session's item is in the "In a session" group.
 */
export function SuggestedInChats({ suggestions, readError, pending, problems, drafts, now, actions }: {
  suggestions: readonly Suggestion[] | undefined;
  readError?: string | undefined;
  pending: Readonly<Record<string, SuggestionAction | "dismiss" | "restore">>;
  problems: Readonly<Record<string, string>>;
  drafts: Readonly<Record<string, SuggestionDraft>>;
  now: number;
  actions: SuggestedInChatsActions;
}) {
  const [open, setOpen] = useState(true);
  const rows = suggestions ?? [];
  if (readError !== undefined && rows.length === 0) {
    return <ReadoutLine action={<TextButton label="Retry" onPress={actions.onRetry} />}>Could not read the suggestions from your chats. {readError}</ReadoutLine>;
  }
  if (rows.length === 0) return null;
  return <RecordGroup label="Suggested in chats" count={rows.length} open={open} onToggle={() => setOpen(!open)} emphasis>
    {rows.map((suggestion) => {
      const state = suggestion.state;
      const { busy, filing, problem, offer } = rowState(suggestion, pending, problems);
      const words = destinationWords(suggestion.destination);
      const ago = agoText(suggestion.createdAt, now);
      const from = suggestion.sessionTitle ?? "a chat";
      return <PendingRow key={suggestion.id} title={wordsOf(suggestion, drafts[suggestion.id]).title}
        detail={filing ? "Filing…" : problem ?? <>Suggested in <em>{from}</em>{ago ? `, ${ago}` : ""}. {words.lead} <code>{words.code}</code>{state.kind === "duplicate" ? ". It has a close match: show it in the chat to decide" : ""}</>}
        detailTone={problem !== undefined ? "bad" : undefined}
        actions={<ActionFooter actions={[
          ...(offer ? [{ label: "File", tone: "primary" as const, disabled: busy, onPress: () => actions.onFile(suggestion.id) },
            { label: "File and act", disabled: busy, onPress: () => actions.onFileAndAct(suggestion.id) }] : []),
          { label: "Show in chat", tone: "quiet", onPress: () => actions.onShow(suggestion) }]} />} />;
    })}
  </RecordGroup>;
}
