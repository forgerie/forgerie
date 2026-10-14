// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { ActionBarPrimitive, AuiIf, ErrorPrimitive, groupPartByType, MessagePrimitive, useAui, useAuiState, type GroupByContext, type PartState } from "@assistant-ui/react";
import { useMemo, useState, type ReactNode } from "react";
import { artifactDoor, artifactFiled, type HistorySummaryKind, type PullNoticeArtifact, type ShellArtifact, type SummaryArtifact } from "../transcript";
import { PullNoticeRow } from "./PullNoticeRow";
import { SessionDoorCall } from "./SessionDoor";
import { EventSentence } from "./EventSentence";
import { ShellRun } from "./ShellRun";
import { MarkdownText } from "./MarkdownText";
import type { FileLinks } from "./FileTree";
import { CopyButton } from "./CopyButton";
import { createLatest, useLatest, type Latest } from "./latest";
import { ChainOfThoughtGroup, SkillLoad, SkillLoadGroup, stepIdOf, ToolCall, TraceLine, useToolSteps, WorkingLine, type ToolStepView } from "./Trace";
import { TallyRow } from "./TallyRow";
import { RailSection } from "./RailSection";
import { UserMessageAttachments } from "./Attachments";
import { ReplyGallery } from "./ImageGallery";
import { SkillInvocationRecord } from "./SkillInvocation";
import { skillLoadOf } from "../skills";

// Consecutive reasoning and tools share one fold. Text stays outside. Inside
// the fold, reasoning reads as text and each tool is one line, so no fold
// opens only to show another fold.
type StepKey = `group-step:${string}`;
type GroupKey = "group-chainOfThought" | "group-skills" | "group-work" | StepKey;
const groupActivity = groupPartByType<GroupKey>({
  reasoning: ["group-chainOfThought"],
  "tool-call": ["group-chainOfThought"],
});
const skillGroup = ["group-skills"] as const;
// A call that created a session or filed an issue stands outside the collapsed
// activity, so its door or its issue is never hidden, and the activity does not
// count the same call again.
// Skill loads also stay visible beside the activity, and adjacent loads share
// a line. The helper groups by tool name; this branches on a call's arguments
// and result, so it is a stable module-level function instead.
//
// A step (one Pi message that calls tools) is grouped first: the transcript
// marks its parts with a `parentId`, so the boundary between two steps is
// the message boundary, not a guess from part types. Adjacent silent steps
// share a row, so a step's group is its row.
//
// In a reply with steps, everything but the model's own text is work, and
// work hangs from one rail. Text a step does not own is the answer, so it
// stays outside: the rail ends where the answer begins.
const STEP_GROUP = "group-step:";
const WORK: readonly GroupKey[] = ["group-work"];
const isStepKey = (key: string): key is StepKey => key.startsWith(STEP_GROUP);
function activityPath(part: PartState, context: GroupByContext): readonly GroupKey[] {
  if (part.type !== "tool-call") return groupActivity(part, context);
  if (artifactDoor(part.artifact) || artifactFiled(part.artifact)) return [];
  return skillLoadOf(part.toolName, part.args) ? skillGroup : groupActivity(part, context);
}
function groupAssistantParts(rowOf: ReadonlyMap<string, string>) {
  const hasSteps = rowOf.size > 0;
  return (part: PartState, context: GroupByContext): readonly GroupKey[] => {
    const step = stepIdOf(part);
    if (step !== undefined) return [...WORK, `${STEP_GROUP}${rowOf.get(step) ?? step}`];
    if (!hasSteps) return activityPath(part, context);
    if (part.type === "text" || part.type === "image") return [];
    return [...WORK, ...activityPath(part, context)];
  };
}

function ResponseCopy() {
  const aui = useAui();
  return <CopyButton label="Copy response" getText={() => aui.message.getCopyText()} />;
}

// A step renders its parts by index: narration as the row's text, thinking
// and calls in its panel.
type StepParts = { text: { Text: () => ReactNode }; thought: { Reasoning: () => ReactNode } };
const stepTools = { tools: { Fallback: ToolCall } };
function stepRow(step: ToolStepView, { text: stepText, thought: stepThought }: StepParts) {
  const parts = (indices: readonly number[], components: Parameters<typeof MessagePrimitive.PartByIndex>[0]["components"]) =>
    indices.map((index) => <MessagePrimitive.PartByIndex key={index} index={index} components={components} />);
  return <TallyRow marks={step.marks} label={step.label} title={step.title} line={step.line} live={step.live}
    sections={() => step.sections.map((section) => ({ key: section.id,
      ...(section.thoughts.length > 0 ? { notes: parts(section.thoughts, stepThought) } : {}),
      body: parts(section.tools, stepTools) }))}>
    {step.narration.length > 0 ? parts(step.narration, stepText) : undefined}
  </TallyRow>;
}

// The invocation renders apart from the bubble, which keeps only the typed argument.
const invocationParts = { Text: () => null, data: { by_name: { skill: SkillInvocationRecord } } };

/** Whether the binding marked this message, such as the search match the reader opened. */
const isMarked = (custom: Record<string, unknown> | undefined) => custom?.["marked"] === true;

export function UserMessage() {
  const marked = useAuiState((s) => isMarked(s.message.metadata.custom));
  return <MessagePrimitive.Root className="message message-user" data-role="user" aria-label="Your message" data-marked={marked || undefined}>
    <UserMessageAttachments />
    <MessagePrimitive.Parts components={invocationParts} />
    <AuiIf condition={(s) => s.message.content.some((part) => part.type === "text" && part.text.length > 0)}>
      <div className="user-bubble message-text"><MessagePrimitive.Parts /></div>
    </AuiIf>
  </MessagePrimitive.Root>;
}

/** `fileLinks` opens the files a reply names in a `files` block. */
export function AssistantMessage({ fileLinks }: { fileLinks?: FileLinks | undefined }) {
  const steps = useToolSteps();
  const stepParts = useMemo<StepParts>(() => ({
    text: { Text: () => <MarkdownText fileLinks={fileLinks} /> },
    thought: { Reasoning: () => <MarkdownText fileLinks={fileLinks} /> },
  }), [fileLinks]);
  const groupBy = useMemo(() => groupAssistantParts(steps.rowOf), [steps]);
  // While the reply streams, text after the last step may still turn out to
  // introduce a call, so the rule waits until the reply settles.
  const settled = useAuiState((s) => s.message.status?.type !== "running");
  const boundary = steps.boundary;
  const closing = settled && boundary?.answered ? boundary : undefined;
  const marked = useAuiState((s) => isMarked(s.message.metadata.custom));
  return <MessagePrimitive.Root className="message message-assistant" data-role="assistant" aria-label="Assistant reply" data-marked={marked || undefined}>
    <div className="message-text">
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          if (isStepKey(part.type)) {
            const step = steps.rows.get(part.type.slice(STEP_GROUP.length));
            return step ? stepRow(step, stepParts) : <>{children}</>;
          }
          switch (part.type) {
            case "group-work": return <RailSection {...(closing && part.indices.includes(closing.lastStep) ? { end: closing.summary } : {})}>{children}</RailSection>;
            case "group-chainOfThought": return <ChainOfThoughtGroup indices={part.indices} running={part.status.type === "running"}>{children}</ChainOfThoughtGroup>;
            case "group-skills": return part.indices.length === 1 ? <>{children}</>
              : <SkillLoadGroup indices={part.indices} running={part.status.type === "running"}>{children}</SkillLoadGroup>;
            case "text": return part.text === "" && part.status.type === "running"
              ? <TraceLine live label="working" /> : <MarkdownText fileLinks={fileLinks} />;
            case "reasoning": return <div className="reasoning-text"><MarkdownText fileLinks={fileLinks} /></div>;
            case "tool-call": {
              const door = artifactDoor(part.artifact);
              const filed = artifactFiled(part.artifact);
              // A filed issue keeps the ordinary tool line, so its input and output stay one tap away, and adds the issue under it.
              return door ? <SessionDoorCall {...part} door={door} />
                : filed ? <><ToolCall {...part} /><EventSentence tone="positive">Filed {filed.href === undefined ? <>#{filed.number} <strong>{filed.title}</strong></>
                  : <a href={filed.href} target="_blank" rel="noreferrer">#{filed.number} <strong>{filed.title}</strong></a>}</EventSentence></>
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
const summaryParts = { Text: () => <MarkdownText /> };

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

const NO_ARTIFACT_VIEW = createLatest<SystemArtifactView | undefined>(undefined);

/** System messages carry Pi system text, a history summary, or a user's `!` command; each selects its own view. */
export function SystemMessage({ artifact = NO_ARTIFACT_VIEW }: { artifact?: Latest<SystemArtifactView | undefined> | undefined }) {
  const custom = useAuiState((s) => s.message.metadata.custom);
  const view = useLatest(artifact)?.(custom);
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
