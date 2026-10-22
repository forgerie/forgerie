// The transcript card's inputs, from this chat's suggestion store and the session list. The session binding draws
// the card with them wherever a `suggest_backlog` result sits in the thread.
import type { ComponentProps } from "react";
import type { SessionModel } from "../../contracts";
import type { SessionLook } from "../backlogModel";
import type { SuggestionCard } from "./SuggestionCard";
import type { SuggestionRef } from "./suggestionsApi";
import type { SuggestionsStore, SuggestionsView } from "./suggestionsStore";
import { backgroundOf, launchModel, markdownOf } from "./suggestionsModel";

export interface CardLinks {
  look: (sessionId: string) => SessionLook | undefined;
  /** The only way the card moves the reader: into a background session. */
  openSession: (sessionId: string) => void;
  openLink: (url: string) => void;
  /**
   * Opens a filed Markdown item by its project and its path in that project's main checkout, where the server commits
   * it. Absent: a filed path is words only.
   */
  openFile?: ((projectId: string, path: string) => void) | undefined;
  copy: (text: string) => Promise<boolean>;
}

export function cardInputs({ reference, view, store, links, chat, knownModels, listModels, now }: {
  reference: SuggestionRef; view: SuggestionsView; store: SuggestionsStore; links: CardLinks;
  chat: { model?: SessionModel | undefined; thinkingLevel?: string | undefined };
  knownModels: readonly SessionModel[]; listModels: ((signal: AbortSignal) => Promise<SessionModel[]>) | undefined; now: number;
}): ComponentProps<typeof SuggestionCard> {
  const id = reference.suggestionId;
  const suggestion = view.suggestions?.find((record) => record.id === id);
  const read = suggestion !== undefined ? { type: "ready" as const }
    : view.readError !== undefined ? { type: "failed" as const, message: view.readError }
    : view.suggestions !== undefined && store.asked(id) && !view.reading ? { type: "missing" as const } : { type: "loading" as const };
  const draft = view.drafts[id];
  return {
    suggestion, destination: reference.destination, read, press: view.pending[id], problem: view.problems[id], draft, last: view.last[id],
    launch: suggestion ? launchModel(suggestion, view.models[id], chat, knownModels) : { source: "chat" },
    background: suggestion?.state.kind === "started" ? backgroundOf(suggestion.state.sessionId, links.look) : undefined,
    knownModels, listModels, now, markdown: suggestion ? markdownOf(suggestion, draft) : "",
    actions: {
      onFile: () => { void store.file(id); }, onFileAndAct: () => { void store.fileAndAct(id); },
      onDismiss: () => { void store.dismiss(id); }, onRestore: () => { void store.restore(id); },
      onDraft: (next) => store.setDraft(id, next), onModel: (model) => store.setModel(id, model),
      onOpenSession: links.openSession, onOpenLink: links.openLink, onOpenFile: links.openFile && suggestion ? (path) => links.openFile?.(suggestion.projectId, path) : undefined, onCopy: links.copy, onRetryRead: () => { void store.refresh(); },
    },
  };
}
