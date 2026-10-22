import { useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, CopyIcon } from "lucide-react";
import type { SessionModel } from "../../contracts";
import { thinkingLevelsFor } from "../../newSession";
import { DecisionCard } from "../../ui/DecisionCard";
import { ActionFooter, type FooterAction } from "../../ui/ActionFooter";
import { ReadoutLine } from "../../ui/ReadoutLine";
import { TextButton } from "../../ui/TextButton";
import { Disclosure } from "../../ui/Disclosure";
import { FileTree } from "../../ui/FileTree";
import { Consequence } from "../../ui/Consequence";
import { TextAreaField } from "../../ui/TextAreaField";
import { FieldEdit } from "../../ui/FieldEdit";
import { StatusRow } from "../../ui/StatusRow";
import { LoadingLines } from "../../ui/LoadingLines";
import { ModelPicker, type PickerOpen } from "../../ui/ModelPicker";
import type { Suggestion, SuggestionDestination, SuggestionModel, SuggestionState } from "./suggestionsApi";
import { agoText, contextCount, destinationWords, edited, filedWords, hasContext, modelFromSpec, modelWords, specOf, wordsOf,
  type BackgroundTone, type SuggestionAction, type SuggestionDraft } from "./suggestionsModel";

/** The press in flight, as the store holds it. */
export type CardPress = SuggestionAction | "dismiss" | "restore";
/** The model a File and act would start on, and where that choice came from. */
export interface CardLaunch { model?: SessionModel | undefined; thinkingLevel?: string | undefined; source: "chosen" | "default" | "chat" }
/** How the background session stands, from the session list. */
export interface CardBackground { tone: BackgroundTone; status: string; name?: string | undefined; time?: string | undefined; known: boolean }
export interface SuggestionCardActions {
  onFile: () => void;
  /** Files and starts a background session. The reader stays in this chat. */
  onFileAndAct: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDraft: (draft: SuggestionDraft | undefined) => void;
  /** This launch's model. Undefined goes back to the default. */
  onModel: (model: SuggestionModel | undefined) => void;
  /** The only press that moves the reader: into the background session. */
  onOpenSession: (sessionId: string) => void;
  onOpenLink: (url: string) => void;
  /** Opens a filed Markdown item from its project's main checkout. Absent: the path is words only. */
  onOpenFile?: ((path: string) => void) | undefined;
  onCopy: (text: string) => Promise<boolean>;
  onRetryRead: () => void;
}

const TITLE = "Backlog suggestion";
const providerName = (destination: SuggestionDestination) => destination.provider === "github" ? "GitHub" : "the backlog folder";

function where(destination: SuggestionDestination) {
  const words = destinationWords(destination);
  return <ReadoutLine>{words.lead} <code>{words.code}</code>{words.tail ? ` ${words.tail}` : null}</ReadoutLine>;
}

/**
 * Shape: one backlog suggestion in the chat, drawn from the server's record so a reload shows its last outcome.
 * Open, it is an offer, not a decision that holds the chat up: the rule is full ink, and File, File and act and
 * Dismiss sit under where it goes. File and act names the model its background session starts on, with Change.
 * Filed, it goes quiet and links the item; started, the background session's row is the only way into it.
 */
export function SuggestionCard({ suggestion, destination, read, press, problem, draft, last, launch, background, knownModels = [], listModels, now, actions, markdown, initialEditing = false }: {
  /** The server's record. Undefined while the first read runs, or when the read did not find it. */
  suggestion: Suggestion | undefined;
  /** Where the transcript said it goes, for the words before the record arrives. */
  destination?: SuggestionDestination | undefined;
  read: { type: "loading" } | { type: "missing" } | { type: "failed"; message: string } | { type: "ready" };
  press?: CardPress | undefined;
  problem?: string | undefined;
  draft?: SuggestionDraft | undefined;
  /** The last action pressed on this card, so Retry repeats it when the record does not say which action failed. */
  last?: SuggestionAction | undefined;
  launch: CardLaunch;
  background?: CardBackground | undefined;
  /** The models the chat knows, for names. */
  knownModels?: readonly SessionModel[];
  /** The chat's model list, for Change. Absent: no Change. */
  listModels?: ((signal: AbortSignal) => Promise<SessionModel[]>) | undefined;
  now: number;
  actions: SuggestionCardActions;
  /** The item as Markdown, for Copy as Markdown. */
  markdown: string;
  /** Open with the title and body as fields, such as when the reader came back to a draft. */
  initialEditing?: boolean;
}) {
  const [editing, setEditing] = useState(initialEditing);
  const [modelOpen, setModelOpen] = useState<PickerOpen>();
  const [copied, setCopied] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  if (suggestion === undefined) {
    return <DecisionCard title={TITLE} edge="ink" open>
      {read.type === "failed" ? <ReadoutLine action={<TextButton label="Retry" onPress={actions.onRetryRead} />}>Could not read this suggestion. {read.message}</ReadoutLine>
        : read.type === "missing" ? <ReadoutLine>{destination ? <>This suggestion for {providerName(destination)} is not in Forgerie's records.</> : "This suggestion is not in Forgerie's records."}</ReadoutLine>
        : <LoadingLines label="Reading the suggestion…" widths={[70, 90]} />}
    </DecisionCard>;
  }

  const state: SuggestionState = suggestion.state;
  if (state.kind === "dismissed") {
    return <ReadoutLine action={<TextButton label={press === "restore" ? "Restoring…" : "Restore"} disabled={press !== undefined} onPress={actions.onRestore} />}>
      Dismissed backlog suggestion: <strong>{wordsOf(suggestion, draft).title}</strong>
    </ReadoutLine>;
  }

  const words = wordsOf(suggestion, draft);
  const changed = edited(suggestion, draft);

  if (state.kind === "filed" || state.kind === "started") {
    const filed = filedWords(state, suggestion.destination);
    const ago = agoText(state.at, now);
    const line = <>{filed.lead}{filed.code ? <> <code>{filed.code}</code></> : null}{filed.tail ? ` ${filed.tail}` : null}</>;
    const run = state.kind === "started" && background ? <StatusRow tone={background.tone} mark="block"
      name={modelWords(modelFromSpec(state.modelSpec, knownModels)) ?? "Background session"} detail={background.name} status={background.status} meta={background.time}
      go="Open" label={`Open the background session${background.name ? `, ${background.name}` : ""}`} onPress={() => actions.onOpenSession(state.sessionId)} /> : null;
    const launchError = state.kind === "filed" ? state.launchError : undefined;
    // A launch retry runs on the choice the server recorded at filing, so the card names that one and offers no Change.
    const recorded = state.kind === "filed" ? state.launchChoice : undefined;
    const retryModel = modelWords(modelFromSpec(recorded?.modelSpec, knownModels)) ?? modelWords(launch.model) ?? "this chat's model";
    // A Markdown item has no web page: its file opens in the chat's file reader, on a press.
    const filePath = state.url === undefined && state.number === undefined
      ? state.path ?? (suggestion.destination.provider === "markdown" ? suggestion.destination.path : undefined) : undefined;
    const detail = <>
      {run}
      {launchError ? <Consequence tone="warn" icon={<CircleAlertIcon />}
        actions={launchError.retryable && press === undefined ? [{ label: "Start session", onPress: actions.onFileAndAct }] : undefined}>
        <p>Filed, but the background session did not start: {launchError.message}</p>
        {press === "file-and-act" ? <p>Starting the session…</p> : launchError.retryable ? <p>Start session starts it on <strong>{retryModel}</strong>.</p> : null}
      </Consequence> : null}
      {problem ? <ReadoutLine>{problem}</ReadoutLine> : null}
      {state.decisionLogWarning ? <ReadoutLine>{state.decisionLogWarning}</ReadoutLine> : null}
    </>;
    return <DecisionCard title={TITLE} edge="ink" open={false} meta={ago ? `Filed ${ago}` : "Filed"} lead={words.title}
      closed={line} closedHref={state.url} closedPress={filePath !== undefined && actions.onOpenFile ? () => actions.onOpenFile?.(filePath) : undefined}
      focusClosed={last !== undefined} closedDetail={detail} />;
  }

  // Open: open, filing, duplicate, failed.
  const filing = press === "file" || press === "file-and-act" ? press : state.kind === "filing" ? (state.action === "file-and-act" ? "file-and-act" : "file") : undefined;
  const busy = filing !== undefined || press !== undefined;
  // Retry repeats the action that failed, as the server records it; without that field, the last one pressed here.
  const retry = (state.kind === "failed" ? state.action : undefined) ?? last ?? "file";
  const modelName = modelWords(launch.model) ?? "this chat's model";
  const modelSentence = (lead: string) => <ReadoutLine>
    {lead} <strong>{modelName}</strong>{launch.source === "chat" && launch.model ? ", this chat's model" : launch.source === "default" ? ", the backlog's default" : ""}.
    {listModels ? <> <span ref={anchor}><ModelPicker word="Change" anchor={anchor} open={modelOpen} onOpenChange={setModelOpen} minWidthRem={18} binding={{
      model: launch.model, thinkingLevel: launch.thinkingLevel, disabled: busy, listModels, thinking: launch.model !== undefined,
      listThinkingLevels: async () => thinkingLevelsFor(launch.model),
      onModel: async (provider, id) => { actions.onModel({ modelSpec: `${provider}/${id}`, thinkingLevel: launch.thinkingLevel }); },
      onThinkingLevel: async (level) => { actions.onModel({ modelSpec: specOf(launch.model), thinkingLevel: level }); },
    }} /></span>{launch.source === "chosen" ? <TextButton label="Use the default" onPress={() => actions.onModel(undefined)} /> : null}</> : null}
  </ReadoutLine>;
  const dismiss: FooterAction = { label: press === "dismiss" ? "Dismissing…" : "Dismiss", tone: "quiet", disabled: busy, onPress: actions.onDismiss };
  const copy: FooterAction = { label: copied ? "Copied" : "Copy as Markdown", onPress: () => { void actions.onCopy(markdown).then((ok) => { setCopied(ok); }); } };
  const azure = suggestion.azureReadOnlyNote ? <ReadoutLine>Azure DevOps boards are read-only in Forgerie, so this item goes to {providerName(suggestion.destination)} instead.</ReadoutLine> : null;

  let footerActions: FooterAction[];
  let note: ReactNode;
  if (state.kind === "duplicate") {
    const first = state.matches.find((match) => match.url !== undefined);
    footerActions = [
      { label: filing === "file" ? "Filing…" : "File anyway", tone: "primary", disabled: busy, onPress: actions.onFile },
      ...(first?.url ? [{ label: first.number !== undefined ? `Open #${String(first.number)}` : "Open the match", onPress: () => actions.onOpenLink(first.url!) }] : []),
      dismiss,
    ];
    note = <>{where(suggestion.destination)}{azure}</>;
  } else if (state.kind === "failed") {
    footerActions = [
      ...(state.retryable ? [{ label: filing ? "Filing…" : "Retry", tone: "primary" as const, disabled: busy, onPress: retry === "file-and-act" ? actions.onFileAndAct : actions.onFile }] : []),
      copy, dismiss,
    ];
    note = <>{where(suggestion.destination)}{azure}{state.retryable && retry === "file-and-act" ? modelSentence("Retry also starts a new session on") : null}</>;
  } else {
    footerActions = [
      { label: filing === "file" ? "Filing…" : "File", tone: "primary", disabled: busy, onPress: actions.onFile },
      { label: filing === "file-and-act" ? "Filing…" : "File and act", disabled: busy, onPress: actions.onFileAndAct },
      dismiss,
    ];
    note = <>{where(suggestion.destination)}{azure}{modelSentence("File and act starts a new session on")}</>;
  }

  const matches = state.kind === "duplicate" && state.matches.length > 0 ? <Consequence icon={<CopyIcon />}>
    <p><strong>{suggestion.destination.provider === "github" ? "GitHub" : "The backlog"} has {state.matches.length === 1 ? "a close match" : `${String(state.matches.length)} close matches`}.</strong> Nothing is filed yet.</p>
    {state.matches.map((match) => <p key={`${String(match.number ?? "")}:${match.path ?? match.title}`}>
      {match.url ? <a href={match.url} target="_blank" rel="noreferrer">{match.number !== undefined ? `#${String(match.number)} ` : ""}{match.title}</a>
        : <>{match.number !== undefined ? `#${String(match.number)} ` : ""}{match.title}</>}
      {match.path ? <> <code>{match.path}</code></> : null} {match.state}
    </p>)}
  </Consequence> : null;

  const context = suggestion.context;
  const count = contextCount(context);
  const body = editing ? <FieldEdit reset={changed ? { label: "Use the agent's words", title: "Go back to the title and body the agent wrote", onPress: () => actions.onDraft(undefined) } : undefined}>
    <TextAreaField label="Title" rows={1} value={words.title} onChange={(title) => actions.onDraft({ ...words, title: title.replace(/\s*\n\s*/gu, " ") })} />
    <TextAreaField label="Body" rows={4} value={words.body} onChange={(text) => actions.onDraft({ ...words, body: text })} />
  </FieldEdit> : <>
    {words.body.trim() ? <p>{words.body}</p> : null}
    {hasContext(context) ? <Disclosure summary={`Context for the next session${count ? ` (${count})` : ""}`}>
      {context.why.trim() ? <p><strong>Why it came up.</strong> {context.why}</p> : null}
      {context.files.length ? <FileTree code={context.files.join("\n")} /> : null}
      {context.decisions.length ? <><p><strong>Decided in this chat</strong></p><ul>{context.decisions.map((decision) => <li key={decision}>{decision}</li>)}</ul></> : null}
    </Disclosure> : <ReadoutLine>No chat context: the item is its title and body alone.</ReadoutLine>}
  </>;

  return <DecisionCard title={TITLE} edge="ink" open pinChoices meta={changed && !editing ? "Edited" : undefined}
    headAction={busy ? undefined : <TextButton label={editing ? "Done" : "Edit"} pressed={editing} onPress={() => setEditing(!editing)} />}
    lead={editing ? undefined : words.title} problem={problem ?? (state.kind === "failed" ? state.message : undefined)} annotation={matches}
    footer={<ActionFooter note={note} actions={footerActions} noteLastWhenShort />}>
    {body}
  </DecisionCard>;
}
