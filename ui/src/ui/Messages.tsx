// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { ActionBarPrimitive, AuiIf, ErrorPrimitive, groupPartByType, MessagePrimitive, useAui, useAuiState, type GroupByContext, type PartState } from "@assistant-ui/react";
import { useState, type ReactNode } from "react";
import { artifactDoor, type HistorySummaryKind, type PullNoticeArtifact, type ShellArtifact, type SummaryArtifact } from "../transcript";
import { PullNoticeRow } from "./PullNoticeRow";
import { SessionDoorCall } from "./SessionDoor";
import { ShellRun } from "./ShellRun";
import { MarkdownText } from "./MarkdownText";
import { CopyButton } from "./CopyButton";
import { ChainOfThoughtGroup, SkillLoad, SkillLoadGroup, ToolCall, TraceLine, useToolSteps, WorkingLine, type ToolStepView } from "./Trace";
import { TallyRow } from "./TallyRow";
import { STEP_PREFIX } from "./stepPart";
import { UserMessageAttachments } from "./Attachments";
import { ReplyGallery } from "./ImageGallery";
import { SkillInvocationRecord } from "./SkillInvocation";
import { skillLoadOf } from "../skills";

// Consecutive reasoning and tools share one fold. Text stays outside. Inside
// the fold, reasoning reads as text and each tool is one line, so no fold
// opens only to show another fold.
type StepKey = `group-step:${string}`;
type GroupKey = "group-chainOfThought" | "group-skills" | StepKey;
const groupActivity = groupPartByType<GroupKey>({
  reasoning: ["group-chainOfThought"],
  "tool-call": ["group-chainOfThought"],
});
const skillGroup = ["group-skills"] as const;
// A call that created a session stands outside the collapsed activity, so its
// door is never hidden, and the activity does not count the same call again.
// Skill loads also stay visible beside the activity, and adjacent loads share
// a line. The helper groups by tool name; this branches on a call's arguments
// and result, so it is a stable module-level function instead.
//
// A step (one Pi message that calls tools) is its own group first: the
// transcript marks its parts with a `parentId`, so the boundary between two
// steps is the message boundary, not a guess from part types.
const STEP_GROUP = "group-step:";
const isStepKey = (key: string): key is StepKey => key.startsWith(STEP_GROUP);
function groupAssistantParts(part: PartState, context: GroupByContext): readonly GroupKey[] {
  const parentId = "parentId" in part ? part.parentId : undefined;
  if (typeof parentId === "string" && parentId.startsWith(STEP_PREFIX)) return [`${STEP_GROUP}${parentId.slice(STEP_PREFIX.length)}`];
  if (part.type !== "tool-call") return groupActivity(part, context);
  if (artifactDoor(part.artifact)) return [];
  return skillLoadOf(part.toolName, part.args) ? skillGroup : groupActivity(part, context);
}

function ResponseCopy() {
  const aui = useAui();
  return <CopyButton label="Copy response" getText={() => aui.message.getCopyText()} />;
}

// A step renders its parts by index: narration as the row's text, thinking
// and calls in its panel.
const stepText = { Text: MarkdownText };
const stepThought = { Reasoning: MarkdownText };
const stepTools = { tools: { Fallback: ToolCall } };
function stepRow(step: ToolStepView) {
  const parts = (indices: readonly number[], components: Parameters<typeof MessagePrimitive.PartByIndex>[0]["components"]) =>
    indices.map((index) => <MessagePrimitive.PartByIndex key={index} index={index} components={components} />);
  return <TallyRow marks={step.marks} label={step.label} title={step.title} line={step.line} live={step.live}
    {...(step.thoughts.length > 0 ? { notes: () => parts(step.thoughts, stepThought) } : {})}
    panel={() => parts(step.tools, stepTools)}>
    {step.narration.length > 0 ? parts(step.narration, stepText) : undefined}
  </TallyRow>;
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
  const steps = useToolSteps();
  return <MessagePrimitive.Root className="message message-assistant" data-role="assistant" aria-label="Assistant reply">
    <div className="message-text">
      <MessagePrimitive.GroupedParts groupBy={groupAssistantParts}>
        {({ part, children }) => {
          if (isStepKey(part.type)) {
            const step = steps.get(part.type.slice(STEP_GROUP.length));
            return step ? stepRow(step) : <>{children}</>;
          }
          switch (part.type) {
            case "group-chainOfThought": return <ChainOfThoughtGroup indices={part.indices} running={part.status.type === "running"}>{children}</ChainOfThoughtGroup>;
            case "group-skills": return part.indices.length === 1 ? <>{children}</>
              : <SkillLoadGroup indices={part.indices} running={part.status.type === "running"}>{children}</SkillLoadGroup>;
            case "text": return part.text === "" && part.status.type === "running"
              ? <TraceLine live label="working" /> : <MarkdownText />;
            case "reasoning": return <div className="reasoning-text"><MarkdownText /></div>;
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
function isPullNoticeArtifact(value: Record<string, unknown> | undefined): value is PullNoticeArtifact {
  const notice = value?.["pullNotice"];
  return typeof notice === "object" && notice !== null && "kind" in notice;
}
function isSummaryArtifact(value: Record<string, unknown> | undefined): value is SummaryArtifact {
  return value?.["summary"] === "compaction" || value?.["summary"] === "branch";
}
const summaryLabels: Record<HistorySummaryKind, string> = {
  compaction: "earlier messages compacted into a summary",
  branch: "summary of the branch left behind",
};
const summaryParts = { Text: MarkdownText };

function SummaryCopy() {
  const aui = useAui();
  return <CopyButton label="Copy summary" getText={() => aui.message.getCopyText()} />;
}

/**
 * A summary that stands in for earlier history. It reads as a divider in the
 * thread, and its text opens on request. A summary can run to many thousands
 * of characters, so the body renders only while open and scrolls on its own.
 */
function HistorySummary({ kind }: { kind: HistorySummaryKind }) {
  const [open, setOpen] = useState(false);
  return <MessagePrimitive.Root className="message message-summary" data-role="system" data-summary={kind}>
    <details className="history-summary" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="history-summary-line">
        <span className="trace-marker" aria-hidden>{">"}</span>
        <span className="history-summary-label">{summaryLabels[kind]}</span>
      </summary>
      {open && <div className="history-summary-body">
        <div className="history-summary-text message-text" tabIndex={0} role="region" aria-label="Summary text">
          <MessagePrimitive.Parts components={summaryParts} />
        </div>
        <div className="message-actions"><SummaryCopy /></div>
      </div>}
    </details>
  </MessagePrimitive.Root>;
}

/**
 * Draws a system message's custom metadata as a feature's own view, or
 * returns undefined to leave it to the defaults. Supplied by the binding, so
 * this shared component names no feature.
 */
export type SystemArtifactView = (custom: Record<string, unknown> | undefined) => ReactNode | undefined;

/** System messages carry Pi system text, a history summary, or a user's `!` command; each selects its own view. */
export function SystemMessage({ artifact }: { artifact?: SystemArtifactView | undefined }) {
  const custom = useAuiState((s) => s.message.metadata.custom);
  const view = artifact?.(custom);
  if (view !== undefined) return <MessagePrimitive.Root className="message message-event" data-role="system">{view}</MessagePrimitive.Root>;
  if (isShellArtifact(custom)) return <MessagePrimitive.Root className="message message-shell" data-role="shell">
    <ShellRun run={custom.shell} />
  </MessagePrimitive.Root>;
  if (isSummaryArtifact(custom)) return <HistorySummary kind={custom.summary} />;
  if (isPullNoticeArtifact(custom)) return <PullNoticeRow notice={custom.pullNotice} />;
  return <MessagePrimitive.Root className="message message-system" data-role="system">
    <span className="system-label">System</span>
    <div className="message-text"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}
