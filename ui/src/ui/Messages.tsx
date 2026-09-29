// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { ActionBarPrimitive, ErrorPrimitive, MessagePrimitive, useAui } from "@assistant-ui/react";
import { MarkdownText } from "./MarkdownText";
import { CopyButton } from "./CopyButton";

function ResponseCopy() {
  const aui = useAui();
  return <CopyButton label="Copy response" getText={() => aui.message.getCopyText()} />;
}

export function UserMessage() {
  return <MessagePrimitive.Root className="message message-user" data-role="user" aria-label="Your message">
    <div className="user-bubble message-text"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}

export function AssistantMessage() {
  return <MessagePrimitive.Root className="message message-assistant" data-role="assistant" aria-label="Assistant reply">
    <div className="message-text">
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      <MessagePrimitive.Error><ErrorPrimitive.Root className="message-error">
        <ErrorPrimitive.Message />
      </ErrorPrimitive.Root></MessagePrimitive.Error>
    </div>
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="message-actions">
      <ResponseCopy />
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>;
}

export function SystemMessage() {
  return <MessagePrimitive.Root className="message message-system" data-role="system">
    <span className="system-label">System</span>
    <div className="message-text"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}
