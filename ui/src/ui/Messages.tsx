// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { ActionBarPrimitive, AuiIf, ErrorPrimitive, groupPartByType, MessagePrimitive, useAui, useAuiState, type GroupByContext, type PartState } from "@assistant-ui/react";
import { artifactDoor, type ShellArtifact } from "../transcript";
import { SessionDoorCall } from "./SessionDoor";
import { ShellRun } from "./ShellRun";
import { MarkdownText } from "./MarkdownText";
import { CopyButton } from "./CopyButton";
import { ChainOfThoughtGroup, ReasoningGroup, SkillLoad, SkillLoadGroup, ToolCall, ToolGroup, TraceLine, WorkingLine } from "./Trace";
import { UserMessageAttachments } from "./Attachments";
import { ReplyGallery } from "./ImageGallery";
import { SkillInvocationRecord } from "./SkillInvocation";
import { skillLoadOf } from "../skills";

// A shared prefix groups consecutive reasoning and tools. Text stays outside.
type GroupKey = "group-chainOfThought" | "group-reasoning" | "group-tool" | "group-skills";
const groupActivity = groupPartByType<GroupKey>({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
});
const skillGroup = ["group-skills"] as const;
// A call that created a session stands outside the collapsed activity, so its
// door is never hidden, and the activity does not count the same call again.
// Skill loads also stay visible beside the activity, and adjacent loads share
// a line. The helper groups by tool name; this branches on a call's arguments
// and result, so it is a stable module-level function instead.
function groupAssistantParts(part: PartState, context: GroupByContext): readonly GroupKey[] {
  if (part.type !== "tool-call") return groupActivity(part, context);
  if (artifactDoor(part.artifact)) return [];
  return skillLoadOf(part.toolName, part.args) ? skillGroup : groupActivity(part, context);
}

function ResponseCopy() {
  const aui = useAui();
  return <CopyButton label="Copy response" getText={() => aui.message.getCopyText()} />;
}

// The invocation renders apart from the bubble, which keeps only the typed argument.
const invocationParts = { Text: () => null, data: { by_name: { skill: SkillInvocationRecord } } };

export function UserMessage() {
  return <MessagePrimitive.Root className="message message-user" data-role="user" aria-label="Your message">
    <UserMessageAttachments />
    <MessagePrimitive.Parts components={invocationParts} />
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
            case "group-skills": return part.indices.length === 1 ? <>{children}</>
              : <SkillLoadGroup indices={part.indices} running={part.status.type === "running"}>{children}</SkillLoadGroup>;
            case "text": return part.text === "" && part.status.type === "running"
              ? <TraceLine live label="working" /> : <MarkdownText />;
            case "reasoning": return <MarkdownText />;
            case "tool-call": {
              const door = artifactDoor(part.artifact);
              return door ? <SessionDoorCall {...part} door={door} />
                : skillLoadOf(part.toolName, part.args) ? <SkillLoad {...part} /> : <ToolCall {...part} />;
            }
            // Images gather in the reply gallery below the text.
            case "image": return null;
            case "indicator": return <WorkingLine />;
            default: return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <MessagePrimitive.Error><ErrorPrimitive.Root className="message-error">
        <ErrorPrimitive.Message />
      </ErrorPrimitive.Root></MessagePrimitive.Error>
    </div>
    <ReplyGallery />
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="message-actions">
      <ResponseCopy />
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>;
}

function isShellArtifact(value: Record<string, unknown> | undefined): value is ShellArtifact {
  const shell = value?.["shell"];
  return typeof shell === "object" && shell !== null && "result" in shell;
}
/** System messages carry Pi system text or a user's `!` command, which selects its own view. */
export function SystemMessage() {
  const custom = useAuiState((s) => s.message.metadata.custom);
  if (isShellArtifact(custom)) return <MessagePrimitive.Root className="message message-shell" data-role="shell">
    <ShellRun run={custom.shell} />
  </MessagePrimitive.Root>;
  return <MessagePrimitive.Root className="message message-system" data-role="system">
    <span className="system-label">System</span>
    <div className="message-text"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}
