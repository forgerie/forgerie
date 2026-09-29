// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { AuiIf, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { Composer } from "./Composer";
import { AssistantMessage, SystemMessage, UserMessage } from "./Messages";

// System organism: assistant-ui owns message, composer, and scroll state.
export function Thread() {
  return <ThreadPrimitive.Root className="thread">
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
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </div>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}
