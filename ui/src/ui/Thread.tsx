// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
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

// System organism: assistant-ui owns message, composer, and scroll state.
// `ask` puts the one composer into ask mode. `working` says what a draft can
// do while the session works; `queue` is what already waits.
export function Thread({ ask, mentions, commands, commandResult, compaction, shell, queue, working, model, chatDraft }: { ask?: AskBinding; mentions?: MentionSource | undefined; commands?: CommandBinding; commandResult?: CommandResultBinding; compaction?: CompactionBinding; shell?: ShellBinding; queue?: QueueBinding; working?: WorkingSend; model?: ModelBinding; chatDraft?: ChatDraft }) {
  return <ImageViewerProvider><ThreadPrimitive.Root className="thread">
    <ThreadPrimitive.Viewport className="transcript" aria-label="Conversation" turnAnchor="top">
      <div className="thread-column">
        <AuiIf condition={(s) => s.thread.isLoading && s.thread.messages.length === 0}>
          <div className="history-loading" role="status" aria-label="Loading conversation">
            <div className="skeleton skeleton-user" />
            <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line-short" />
          </div>
        </AuiIf>
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
          <Composer ask={ask} mentions={mentions} commands={commands} compaction={compaction} shell={shell} working={working}
            queued={queue ? queue.items.length > 0 : false} model={model} chatDraft={chatDraft} />
        </ThreadPrimitive.ViewportFooter>
      </div>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root></ImageViewerProvider>;
}
