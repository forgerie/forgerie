const PROMPT_HISTORY_LIMIT = 100;

export interface PromptHistoryMessage {
  readonly role: string;
  readonly promptText?: string;
  readonly parts: readonly {
    readonly type: string;
    readonly text?: string;
    readonly name?: string;
    readonly location?: string;
    readonly content?: unknown;
  }[];
}

export interface PromptHistorySelection {
  readonly anchor: number;
  readonly head: number;
}

export interface PromptHistoryEditorSnapshot {
  readonly text: string;
  readonly selection: PromptHistorySelection;
  readonly atTop: boolean;
  readonly atBottom: boolean;
}

interface PromptHistoryDraft {
  readonly text: string;
  readonly selection: PromptHistorySelection;
}

export type PromptHistoryPosition =
  | { readonly kind: "draft" }
  | { readonly kind: "entry"; readonly index: number; readonly draft: PromptHistoryDraft };

export interface PromptHistoryState {
  readonly entries: readonly string[];
  readonly position: PromptHistoryPosition;
}

export interface PromptHistoryNavigation {
  readonly state: PromptHistoryState;
  readonly editor: {
    readonly text: string;
    readonly selection: PromptHistorySelection;
  };
}

export function promptHistoryEntries(messages: readonly PromptHistoryMessage[]): readonly string[] {
  const entries: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = (message.promptText ?? userPromptText(message)).trim();
    if (text === "" || entries.at(-1) === text) continue;
    entries.push(text);
    if (entries.length === PROMPT_HISTORY_LIMIT) break;
  }
  return entries;
}

function userPromptText(message: PromptHistoryMessage): string {
  return message.parts.flatMap((part) => {
    if (part.type === "text" && part.text !== undefined) return [part.text];
    if (part.type !== "skillInvocation"
      || part.name === undefined
      || part.location === undefined
      || typeof part.content !== "string") return [];
    return [`<skill name="${part.name}" location="${part.location}">\n${part.content}\n</skill>`];
  }).join("");
}

export function createPromptHistory(entries: readonly string[] = []): PromptHistoryState {
  const normalized: string[] = [];
  for (const entry of entries) {
    const text = entry.trim();
    if (text === "" || normalized.at(-1) === text) continue;
    normalized.push(text);
    if (normalized.length === PROMPT_HISTORY_LIMIT) break;
  }
  return { entries: normalized, position: { kind: "draft" } };
}

export function addPromptHistoryEntry(state: PromptHistoryState, text: string): PromptHistoryState {
  const trimmed = text.trim();
  if (trimmed === "") return leavePromptHistory(state);
  const entries = state.entries[0] === trimmed
    ? state.entries
    : [trimmed, ...state.entries].slice(0, PROMPT_HISTORY_LIMIT);
  return { entries, position: { kind: "draft" } };
}

export function leavePromptHistory(state: PromptHistoryState): PromptHistoryState {
  if (state.position.kind === "draft") return state;
  return { ...state, position: { kind: "draft" } };
}

export function navigatePromptHistory(
  state: PromptHistoryState,
  direction: "older" | "newer",
  editor: PromptHistoryEditorSnapshot,
): PromptHistoryNavigation | undefined {
  if (editor.selection.anchor !== editor.selection.head) return undefined;
  if (direction === "older") return navigateOlder(state, editor);
  return navigateNewer(state, editor);
}

function navigateOlder(state: PromptHistoryState, editor: PromptHistoryEditorSnapshot): PromptHistoryNavigation | undefined {
  if (!editor.atTop || state.entries.length === 0) return undefined;
  if (state.position.kind === "draft" && editor.text !== "" && editor.selection.head !== 0) return undefined;

  const index = state.position.kind === "entry" ? state.position.index + 1 : 0;
  const text = state.entries[index];
  if (text === undefined) return undefined;
  const draft = state.position.kind === "entry"
    ? state.position.draft
    : { text: editor.text, selection: editor.selection };
  return {
    state: { entries: state.entries, position: { kind: "entry", index, draft } },
    editor: { text, selection: { anchor: 0, head: 0 } },
  };
}

function navigateNewer(state: PromptHistoryState, editor: PromptHistoryEditorSnapshot): PromptHistoryNavigation | undefined {
  if (!editor.atBottom || state.position.kind === "draft") return undefined;
  const index = state.position.index - 1;
  if (index < 0) {
    return {
      state: { entries: state.entries, position: { kind: "draft" } },
      editor: state.position.draft,
    };
  }
  const text = state.entries[index];
  if (text === undefined) return undefined;
  return {
    state: { ...state, position: { ...state.position, index } },
    editor: { text, selection: { anchor: text.length, head: text.length } },
  };
}
