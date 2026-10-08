// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import type { ReactNode } from "react";
import { AuiIf, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { Composer, type ShellBinding } from "./Composer";
import type { AskBinding } from "./useAskMode";
import type { MentionSource } from "../mentionSource";
import { AssistantMessage, SystemMessage, UserMessage } from "./Messages";
import type { CommandBinding } from "./SlashCommands";
import { CommandResultPanel, type CommandResultBinding } from "./CommandResultPanel";
import { ImageViewerProvider } from "./ImageViewer";
import { CompactionNotice, type CompactionBinding } from "./CompactionNotice";
import type { ChatDraft } from "../chatDraft";
import { QueuedMessages, type QueueBinding } from "./QueuedMessages";
import type { WorkingSend } from "../queue";
import type { ModelBinding } from "./ModelPicker";
import type { DialogBinding } from "./DialogLayer";
import type { NotesBinding } from "./NoteTray";
import type { ComposerSessionKeys } from "./useComposerKeyboard";

// System organism: assistant-ui owns message, composer, and scroll state.
// `ask` puts the one composer into ask mode. `working` says what a draft can
// do while the session works; `queue` is what already waits.
export function Thread({ ask, mentions, commands, commandResult, compaction, shell, sessionKeys, queue, working, model, dialog, attachments, notes, beforeComposer, chatDraft, head, readOnly, inputContext }: { ask?: AskBinding; dialog?: DialogBinding; attachments?: boolean; notes?: NotesBinding | undefined;
  /** A line above the input bar that belongs to this thread, such as a new session's destination. */
  beforeComposer?: ReactNode;
  /** Drawn before the first message, such as a worktree still being set up. */
  head?: ReactNode;
  /** Set when the conversation can no longer continue: drawn where the input bar would be, instead of it. */
  readOnly?: ReactNode;
  /** A readout on the input bar's action row, such as the session's branch. */
  inputContext?: ReactNode; mentions?: MentionSource | undefined; commands?: CommandBinding; commandResult?: CommandResultBinding; compaction?: CompactionBinding; shell?: ShellBinding; sessionKeys?: ComposerSessionKeys | undefined; queue?: QueueBinding; working?: WorkingSend; model?: ModelBinding; chatDraft?: ChatDraft }) {
  return <ImageViewerProvider><ThreadPrimitive.Root className="thread">
    <ThreadPrimitive.Viewport className="transcript" aria-label="Conversation" turnAnchor="top">
      <div className="thread-column">
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
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, SystemMessage }} />
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
  </ThreadPrimitive.Root></ImageViewerProvider>;
}
