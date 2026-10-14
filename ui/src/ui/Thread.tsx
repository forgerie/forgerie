// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuiIf, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { createLatest } from "./latest";
import { Composer, type ShellBinding } from "./Composer";
import type { AskBinding } from "./useAskMode";
import type { MentionSource } from "../mentionSource";
import { AssistantMessage, SystemMessage, UserMessage, type SystemArtifactView } from "./Messages";
import type { CommandBinding } from "./SlashCommands";
import { CommandResultPanel, type CommandResultBinding } from "./CommandResultPanel";
import { ImageViewerProvider } from "./ImageViewer";
import type { FileLinks } from "./FileTree";
import { MarkdownLinkContext } from "./markdown/linkScope";
import { CompactionNotice, type CompactionBinding } from "./CompactionNotice";
import type { ChatDraft } from "../chatDraft";
import { QueuedMessages, type QueueBinding } from "./QueuedMessages";
import type { WorkingSend } from "../queue";
import type { ModelBinding } from "./ModelPicker";
import type { DialogBinding } from "./DialogLayer";
import type { NotesBinding } from "./NoteTray";
import type { ComposerSessionKeys } from "./useComposerKeyboard";
import type { EarlierHistory } from "../historyPaging";

// System organism: assistant-ui owns message, composer, and scroll state.
// `ask` puts the one composer into ask mode. `working` says what a draft can
// do while the session works; `queue` is what already waits.
export function Thread({ ask, mentions, commands, commandResult, compaction, shell, sessionKeys, queue, working, model, dialog, attachments, notes, beforeComposer, chatDraft, head, readOnly, inputContext, systemArtifact, fileLinks, linkBase, linkError, onOpenFile, reveal }: {
  /** Type-only parallel-builder seam. Presentation is supplied by the front-end builder. */
  earlier?: EarlierHistory | undefined;
  /**
   * Scrolls one message into view each time `key` changes, waiting for it to
   * draw. `messageId` is the thread's id for it: a joined reply takes the id
   * of its first message.
   */
  reveal?: { messageId: string; key: string } | undefined;
  /** Base URL for relative Markdown links. Null keeps file links inactive until the binding resolves their folder. */
  linkBase?: string | null | undefined;
  linkError?: string | undefined;
  onOpenFile?: ((path: string) => boolean) | undefined;
  /** A feature view for a system message's custom metadata, such as a process event. */
  systemArtifact?: SystemArtifactView | undefined;
  /** Which files a reply names exist, and how one opens, for the rows of a `files` block. Keep it stable: a new object remounts every message. */
  fileLinks?: FileLinks | undefined; ask?: AskBinding; dialog?: DialogBinding; attachments?: boolean; notes?: NotesBinding | undefined;
  /** A line above the input bar that belongs to this thread, such as a new session's destination. */
  beforeComposer?: ReactNode;
  /** Drawn before the first message, such as a worktree still being set up. */
  head?: ReactNode;
  /** Set when the conversation can no longer continue: drawn where the input bar would be, instead of it. */
  readOnly?: ReactNode;
  /** A readout on the input bar's action row, such as the session's branch. */
  inputContext?: ReactNode; mentions?: MentionSource | undefined; commands?: CommandBinding; commandResult?: CommandResultBinding; compaction?: CompactionBinding; shell?: ShellBinding; sessionKeys?: ComposerSessionKeys | undefined; queue?: QueueBinding; working?: WorkingSend; model?: ModelBinding; chatDraft?: ChatDraft }) {
  // The artifact view changes whenever the binding's data does. System rows read the current one, so they keep
  // their identity and their local state (a decision in flight, its error) across those changes.
  const [artifactView] = useState(() => createLatest(systemArtifact));
  useLayoutEffect(() => { artifactView.set(systemArtifact); }, [artifactView, systemArtifact]);
  const hasArtifact = systemArtifact !== undefined;
  // One component identity per view function, so messages do not remount on each render.
  const components = useMemo(() => ({ UserMessage,
    AssistantMessage: fileLinks ? () => <AssistantMessage fileLinks={fileLinks} /> : AssistantMessage,
    SystemMessage: hasArtifact ? () => <SystemMessage artifact={artifactView} /> : SystemMessage }), [hasArtifact, artifactView, fileLinks]);
  const linkScope = useMemo(() => linkBase === undefined ? undefined : { base: linkBase, error: linkError, openFile: onOpenFile }, [linkBase, linkError, onOpenFile]);
  const column = useRef<HTMLDivElement>(null);
  // The first reveal lands as the thread opens; a later key is a step from one marked message to the next.
  const revealed = useRef<string | undefined>(undefined);
  const revealKey = reveal?.key;
  const revealId = reveal?.messageId;
  useEffect(() => {
    const step = revealed.current !== undefined;
    revealed.current = revealKey;
    return revealId === undefined ? undefined : revealMessage(column.current, revealId, step);
  }, [revealKey, revealId]);
  return <MarkdownLinkContext.Provider value={linkScope}><ImageViewerProvider><ThreadPrimitive.Root className="thread">
    <ThreadPrimitive.Viewport className="transcript" aria-label="Conversation" turnAnchor="top">
      <div ref={column} className="thread-column">
        <AuiIf condition={(s) => s.thread.isLoading && s.thread.messages.length === 0}>
          <div className="history-loading" role="status" aria-label="Loading conversation">
            <div className="skeleton skeleton-user" />
            <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line-short" />
          </div>
        </AuiIf>
        {head}
        <AuiIf condition={(s) => !s.thread.isLoading && !s.thread.isDisabled && s.thread.messages.length === 0}>
          <div className="thread-welcome"><h2>How can I help you today?</h2></div>
        </AuiIf>
        <div className="message-group">
          <ThreadPrimitive.Messages components={components} />
        </div>
        <ThreadPrimitive.ViewportFooter className="composer-region">
          <ThreadPrimitive.ScrollToBottom className="jump icon-button" aria-label="Scroll to bottom" title="Scroll to bottom">
            <ArrowDownIcon aria-hidden size={16} />
          </ThreadPrimitive.ScrollToBottom>
          {commandResult && <CommandResultPanel {...commandResult} />}
          {compaction && <CompactionNotice {...compaction} />}
          {queue && <QueuedMessages {...queue} />}
          {beforeComposer}
          {readOnly ?? <Composer ask={ask} mentions={mentions} commands={commands} compaction={compaction} shell={shell} sessionKeys={sessionKeys} working={working}
            queued={queue ? queue.items.length > 0 : false} model={model} dialog={dialog} attachments={attachments} notes={notes} context={inputContext} chatDraft={chatDraft} />}
        </ThreadPrimitive.ViewportFooter>
      </div>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root></ImageViewerProvider></MarkdownLinkContext.Provider>;
}

/** How long a reveal waits for its message to draw, and keeps it in view against the thread's own scroll to the end. */
const REVEAL_WAIT_MS = 4000;
const REVEAL_HOLD_MS = 1200;
/**
 * Brings the marked message to a quarter of the way down the thread, so a
 * long reply shows its start above the input bar. The thread's own viewport
 * scrolls, never the page. Returns the cleanup.
 */
function revealMessage(column: HTMLDivElement | null, messageId: string, step: boolean): (() => void) | undefined {
  const viewport = column?.parentElement;
  if (!column || !viewport) return undefined;
  // An attribute value in double quotes needs only its quotes and backslashes escaped.
  const selector = `[data-message-id="${messageId.replace(/["\\]/gu, "\\$&")}"]`;
  let frame = 0;
  const started = performance.now();
  let shownAt: number | undefined;
  const smooth = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;
  const place = (target: Element, behavior: ScrollBehavior) => {
    const offset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTo({ top: viewport.scrollTop + offset - viewport.clientHeight / 4, behavior });
  };
  const tick = () => {
    const target = column.querySelector(selector);
    const now = performance.now();
    if (!target) { if (now - started < REVEAL_WAIT_MS) frame = requestAnimationFrame(tick); return; }
    if (shownAt === undefined) {
      // A step glides, and then the reader's own scroll is theirs. The first reveal jumps, and holds
      // the message in view while the opening thread settles at its end.
      if (step && smooth) { place(target, "smooth"); return; }
      place(target, "auto");
      if (step) return;
      shownAt = now;
    } else {
      const box = target.getBoundingClientRect();
      const room = viewport.getBoundingClientRect();
      if (box.bottom < room.top || box.top > room.bottom) place(target, "auto");
    }
    if (now - shownAt < REVEAL_HOLD_MS) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
