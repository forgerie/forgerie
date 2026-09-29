import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";

function TextMessage({ speaker, className }: { speaker: string; className: string }) {
  return <MessagePrimitive.Root className={`message ${className}`}>
    <span className="speaker">{speaker}</span>
    <div className="message-text"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}
function UserMessage() { return <TextMessage speaker="You" className="message-user" />; }
function AssistantMessage() { return <TextMessage speaker="Assistant" className="message-assistant" />; }
function SystemMessage() { return <TextMessage speaker="System" className="message-system" />; }

// System organism: assistant-ui owns composer, message, and scroll behavior.
export function Thread() {
  return <ThreadPrimitive.Root className="thread">
    <ThreadPrimitive.Viewport className="transcript" aria-label="Conversation">
      <ThreadPrimitive.Empty><p className="empty">Send a message to start this conversation.</p></ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, SystemMessage }} />
    </ThreadPrimitive.Viewport>
    <div className="composer-region">
      <ThreadPrimitive.ScrollToBottom className="jump">Latest message</ThreadPrimitive.ScrollToBottom>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input aria-label="Message" placeholder="Message this session" className="composer-input" rows={2} />
        <ThreadPrimitive.If running={false}><ComposerPrimitive.Send className="primary">Send</ComposerPrimitive.Send></ThreadPrimitive.If>
        <ThreadPrimitive.If running><ComposerPrimitive.Cancel className="primary">Stop</ComposerPrimitive.Cancel></ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </div>
  </ThreadPrimitive.Root>;
}
