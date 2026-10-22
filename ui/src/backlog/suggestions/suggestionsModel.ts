// What a backlog suggestion says, in the reader's words. Pure: the card, the sheet, the header button and
// the Backlog view all read their words from here, so one state reads the same everywhere.
import type { SessionModel } from "../../contracts";
import type { SessionLook } from "../backlogModel";
import type { BacklogItem } from "../backlogApi";
import type { Suggestion, SuggestionDestination, SuggestionModel, SuggestionState } from "./suggestionsApi";

export type SuggestionAction = "file" | "file-and-act";
/** What the reader may change before filing. Absent: the agent's words. */
export interface SuggestionDraft { title: string; body: string }

/** Still waits for the reader: nothing is filed yet. */
export const isOpen = (state: SuggestionState) => state.kind === "open" || state.kind === "filing" || state.kind === "duplicate" || state.kind === "failed";
/** The server takes File and File and act from these states only. */
export const canFile = (state: SuggestionState) => state.kind === "open" || state.kind === "duplicate" || (state.kind === "failed" && state.retryable);
export const isFiled = (state: SuggestionState): state is Extract<SuggestionState, { kind: "filed" | "started" }> =>
  state.kind === "filed" || state.kind === "started";

/** The title and body that filing sends: the reader's draft when there is one. */
export function wordsOf(suggestion: Pick<Suggestion, "title" | "body">, draft: SuggestionDraft | undefined): SuggestionDraft {
  return draft ?? { title: suggestion.title, body: suggestion.body };
}
/** Whether the draft says something other than the agent did. */
export const edited = (suggestion: Pick<Suggestion, "title" | "body">, draft: SuggestionDraft | undefined) =>
  draft !== undefined && (draft.title.trim() !== suggestion.title.trim() || draft.body.trim() !== suggestion.body.trim());

/** Where an item goes, as one sentence's object: a path, or a repository and its label. */
export function destinationWords(destination: SuggestionDestination): { lead: string; code: string; tail?: string } {
  return destination.provider === "markdown" ? { lead: "Goes to", code: destination.path }
    : { lead: "Goes to", code: destination.repo, tail: `as an issue, labelled ${destination.label}` };
}

/** Where a filed item went: an issue number on its repository, or the file. */
export function filedWords(state: Extract<SuggestionState, { kind: "filed" | "started" }>, destination: SuggestionDestination): { lead: string; code: string; tail?: string } {
  if (state.number !== undefined) return { lead: `Filed as #${String(state.number)}`, code: "", tail: destination.provider === "github" ? `on ${destination.repo}` : undefined };
  return { lead: "Filed to", code: state.path ?? (destination.provider === "markdown" ? destination.path : destination.repo) };
}

/**
 * The repo-relative file a filed Markdown item lives in: the path the server reports, else the one it was going to.
 * Undefined for an item with a web page or an issue number, which opens there instead.
 */
export function filedPathOf(state: Extract<SuggestionState, { kind: "filed" | "started" }>, destination: SuggestionDestination): string | undefined {
  if (state.url !== undefined || state.number !== undefined) return undefined;
  return state.path ?? (destination.provider === "markdown" ? destination.path : undefined);
}

/** A short age for a moment in the past: "just now", "12m ago", "3h ago", "2d ago". Empty when unreadable. */
export function agoText(at: string, now: number): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${String(hours)}h ago` : `${String(Math.round(hours / 24))}d ago`;
}

/** The model a spec names, with its display name when the list knows it. */
export function modelFromSpec(spec: string | undefined, known: readonly SessionModel[] = []): SessionModel | undefined {
  const match = spec === undefined ? null : /^([^/\s]+)\/(\S+)$/u.exec(spec);
  if (!match?.[1] || !match[2]) return undefined;
  return known.find((model) => model.provider === match[1] && model.id === match[2]) ?? { provider: match[1], id: match[2] };
}
export const specOf = (model: SessionModel | undefined) => model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
/** A model's name for a sentence: its display name, else its id. */
export const modelWords = (model: SessionModel | undefined) => model?.name ?? model?.id;

/**
 * The model a background session starts on: this launch's choice, else the record's default (the project's
 * setting, else the global one), else the chat's own model.
 */
export function launchModel(suggestion: Pick<Suggestion, "defaultModel">, override: SuggestionModel | undefined, chat: { model?: SessionModel | undefined; thinkingLevel?: string | undefined },
  known: readonly SessionModel[] = []) {
  const chosen = override?.modelSpec ?? suggestion.defaultModel.modelSpec;
  if (chosen !== undefined) {
    return { model: modelFromSpec(chosen, known), thinkingLevel: override?.modelSpec !== undefined ? override.thinkingLevel : suggestion.defaultModel.thinkingLevel,
      source: override?.modelSpec !== undefined ? "chosen" as const : "default" as const };
  }
  return { model: chat.model, thinkingLevel: chat.thinkingLevel, source: "chat" as const };
}

/** How the background session stands, from the session list's row for it. */
export type BackgroundTone = "working" | "waiting" | "quiet" | "stopped";
export function backgroundOf(sessionId: string, look: (id: string) => SessionLook | undefined): { tone: BackgroundTone; status: string; name?: string | undefined; time?: string | undefined; known: boolean } {
  const row = look(sessionId);
  if (!row) return { tone: "stopped", status: "Not in the session list", known: false };
  if (row.state === "working") return { tone: "working", status: "Working", name: row.name, time: row.time, known: true };
  if (row.state === "blocked" || row.state === "errored") return { tone: "waiting", status: "Needs you", name: row.name, time: row.time, known: true };
  return { tone: "quiet", status: "Done", name: row.name, time: row.time, known: true };
}

/** The header button: open suggestions as a quiet count, live while a background session needs the reader, a dot while one works. */
export function openerView(suggestions: readonly Suggestion[], look: (id: string) => SessionLook | undefined) {
  const open = suggestions.filter((suggestion) => isOpen(suggestion.state)).length;
  const runs = suggestions.flatMap((suggestion) => suggestion.state.kind === "started" ? [backgroundOf(suggestion.state.sessionId, look)] : []);
  const needs = runs.filter((run) => run.tone === "waiting").length;
  const working = runs.filter((run) => run.tone === "working").length;
  const parts = [`${String(open)} open`, ...(needs ? [`${String(needs)} in background ${needs === 1 ? "needs" : "need"} you`] : []),
    ...(working ? [`${String(working)} in background working`] : [])];
  return { label: `Backlog suggestions, ${parts.join(", ")}`, count: needs > 0 ? needs : open, quiet: needs === 0, active: working > 0 };
}

/** The sheet's three groups, newest first as the list arrives. */
export function groupsOf(suggestions: readonly Suggestion[]) {
  return {
    open: suggestions.filter((suggestion) => isOpen(suggestion.state)),
    filed: suggestions.filter((suggestion) => isFiled(suggestion.state)),
    dismissed: suggestions.filter((suggestion) => suggestion.state.kind === "dismissed"),
  };
}

/** The item as Markdown, for a backlog Forgerie could not write to. */
export function markdownOf(suggestion: Suggestion, draft: SuggestionDraft | undefined): string {
  const words = wordsOf(suggestion, draft);
  const { why, files, decisions } = suggestion.context;
  return [`# ${words.title.trim()}`, words.body.trim(),
    why.trim() ? `## Why it came up\n\n${why.trim()}` : "",
    files.length ? `## Files\n\n${files.map((file) => `- \`${file}\``).join("\n")}` : "",
    decisions.length ? `## Decided\n\n${decisions.map((decision) => `- ${decision}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n") + "\n";
}

/** A count of the context the item carries, for its folded summary: "3 files, 2 decisions". */
export function contextCount(context: Suggestion["context"]): string {
  const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
  return [context.files.length ? plural(context.files.length, "file", "files") : "", context.decisions.length ? plural(context.decisions.length, "decision", "decisions") : ""]
    .filter(Boolean).join(", ");
}
export const hasContext = (context: Suggestion["context"]) => context.why.trim() !== "" || context.files.length > 0 || context.decisions.length > 0;

/**
 * How an open suggestion's row stands in a list: busy while a file is in flight, the reason the last attempt failed,
 * and whether the row may offer File and File and act itself. A duplicate is decided on its card, where the matches show.
 */
export function rowState(suggestion: Pick<Suggestion, "id" | "state">, pending: Readonly<Record<string, string>>, problems: Readonly<Record<string, string>>) {
  const state = suggestion.state;
  const press = pending[suggestion.id];
  const filing = press === "file" || press === "file-and-act" || state.kind === "filing";
  const problem = problems[suggestion.id] ?? (state.kind === "failed" ? state.message : undefined);
  return { busy: press !== undefined, filing, problem: filing ? undefined : problem, offer: canFile(state) && state.kind !== "duplicate" };
}

/** The paths a Markdown File anyway files past: every match the reader was shown. */
export const matchPaths = (state: SuggestionState) => state.kind === "duplicate" ? state.matches.flatMap((match) => match.path === undefined ? [] : [match.path]) : [];
/** The numbers a File anyway files past: every match the reader was shown. */
export const matchNumbers = (state: SuggestionState) => state.kind === "duplicate" ? state.matches.flatMap((match) => match.number === undefined ? [] : [match.number]) : [];

/** A repo-relative path as the backlog lists it: no leading "./" or "/". */
const repoPath = (path: string) => path.trim().replace(/^(?:\.?\/)+/u, "");
/** The backlog's Markdown item a filing wrote: the one in that project whose file is that path in its main checkout. */
export function filedItemOf(items: readonly BacklogItem[] | undefined, projectId: string, path: string): BacklogItem | undefined {
  return items?.find((item) => item.owner.kind === "project" && item.owner.projectId === projectId && item.provider === "markdown"
    && repoPath(item.path) === repoPath(path));
}
