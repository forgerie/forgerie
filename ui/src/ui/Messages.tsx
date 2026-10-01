// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { ActionBarPrimitive, AuiIf, ErrorPrimitive, groupPartByType, MessagePrimitive, useAui } from "@assistant-ui/react";
import { MarkdownText } from "./MarkdownText";
import { CopyButton } from "./CopyButton";
import { ChainOfThoughtGroup, ReasoningGroup, ToolCall, ToolGroup, TraceLine, WorkingLine } from "./Trace";
import { UserMessageAttachments } from "./Attachments";

// A shared prefix groups consecutive reasoning and tools. Text stays outside.
const groupAssistantParts = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
});

function ResponseCopy() {
  const aui = useAui();
  return <CopyButton label="Copy response" getText={() => aui.message.getCopyText()} />;
}

export function UserMessage() {
  return <MessagePrimitive.Root className="message message-user" data-role="user" aria-label="Your message">
    <UserMessageAttachments />
    <AuiIf condition={(s) => s.message.content.some((part) => part.type === "text" && part.text.length > 0)}>
      <div className="user-bubble message-text"><MessagePrimitive.Parts /></div>
    </AuiIf>
  </MessagePrimitive.Root>;
}

export function AssistantMessage() {
  return <MessagePrimitive.Root className="message message-assistant" data-role="assistant" aria-label="Assistant reply">
    <div className="message-text">
      <MessagePrimitive.GroupedParts groupBy={groupAssistantParts}>
        {({ part, children }) => {
          switch (part.type) {
            case "group-chainOfThought": return <ChainOfThoughtGroup indices={part.indices} running={part.status.type === "running"}>{children}</ChainOfThoughtGroup>;
            case "group-reasoning": return <ReasoningGroup running={part.status.type === "running"}>{children}</ReasoningGroup>;
            case "group-tool": return part.indices.length === 1 ? <>{children}</>
              : <ToolGroup indices={part.indices} running={part.status.type === "running"}>{children}</ToolGroup>;
            case "text": return part.text === "" && part.status.type === "running"
              ? <TraceLine live label="working" /> : <MarkdownText />;
            case "reasoning": return <MarkdownText />;
            case "tool-call": return <ToolCall {...part} />;
            case "indicator": return <WorkingLine />;
            default: return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
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
