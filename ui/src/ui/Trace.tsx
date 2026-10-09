// Trace grammar adapted from assistant-ui's homepage demo (trace.tsx,
// trace-line.tsx). See THIRD_PARTY_NOTICES.md. Native <details> replaces the
// site's Collapsible so disclosures need no extra dependency.
import { useAuiState, type PartState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { useMemo, useState, type ReactNode } from "react";
import type { ToolArtifact, ToolState } from "../transcript";
import { STEP_PREFIX } from "./stepPart";
import type { TallyTone } from "./TallyRow";
import { clipOutput, formatToolArgs, summarizeToolArgs } from "../toolSummary";
import { skillLoadOf } from "../skills";
import { ImageGallery, useReplyImages } from "./ImageGallery";

function TraceText({ live, label, detail }: { live: boolean; label: string; detail?: string }) {
  return <span className="trace-text" data-live={live || undefined}>
    <span className="trace-label">{label}</span>{detail ? <span className="trace-detail"> {detail}</span> : null}
  </span>;
}

/** A trace entry that cannot open. */
export function TraceLine({ live, label, detail }: { live: boolean; label: string; detail?: string }) {
  return <div className="trace-line" role={live ? "status" : undefined}>
    <span className="trace-marker" aria-hidden>{">"}</span>
    <TraceText live={live} label={label} {...(detail ? { detail } : {})} />
  </div>;
}

/** Run activity between steps. A running tool already shows its own live line. */
export function WorkingLine() {
  const toolRunning = useAuiState((s) => s.message.parts.some((part) =>
    part.type === "tool-call" && (part.result === undefined || part.isPreliminary === true)));
  return toolRunning ? null : <TraceLine live label="working" />;
}

/** A trace entry that opens. The body renders only while open. */
function Disclosure({ live, label, detail, tone, className, children }: {
  live: boolean; label: string; detail?: string; tone?: "error";
  className?: string; children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <details className={`trace${className ? ` ${className}` : ""}`} data-tone={tone}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="trace-line">
      <span className="trace-marker" aria-hidden>{">"}</span>
      <TraceText live={live} label={label} {...(detail ? { detail } : {})} />
    </summary>
    <div className="trace-body">{children(open)}</div>
  </details>;
}

type ToolView = ToolState["type"] | "failed";
function toolView({ artifact, result, isError }: Pick<ToolCallMessagePartProps, "artifact" | "result" | "isError">): ToolView {
  const state = isToolArtifact(artifact) ? artifact.state : result === undefined ? "pending" : "done";
  return state === "done" && isError ? "failed" : state;
}
function isToolArtifact(value: unknown): value is ToolArtifact {
  return typeof value === "object" && value !== null && "state" in value && typeof value.state === "string";
}
const toolLabels: Record<ToolView, string> = {
  pending: "calling", running: "running", done: "ran", failed: "failed", interrupted: "stopped",
};
function isLive(view: ToolView) { return view === "pending" || view === "running"; }
function outputText(result: unknown): string {
  return typeof result === "string" ? result : result === undefined || result === null ? "" : JSON.stringify(result, null, 2);
}

/** Fallback card for every tool: name, argument summary, expandable input and output. */
export function ToolCall({ toolCallId, toolName, args, result, isError, artifact }:
  Pick<ToolCallMessagePartProps, "toolCallId" | "toolName" | "args" | "result" | "isError" | "artifact">) {
  const view = toolView({ artifact, result, isError });
  const summary = summarizeToolArgs(args);
  return <Disclosure live={isLive(view)} label={toolLabels[view]} detail={summary ? `${toolName} ${summary}` : toolName}
    className="tool-call" {...(view === "failed" ? { tone: "error" as const } : {})}>
    {(open) => open ? <ToolBody view={view} input={formatToolArgs(args)} output={outputText(result)}>
      <ToolImages toolCallId={toolCallId} />
    </ToolBody> : null}
  </Disclosure>;
}

/** This call's images. They open inside the reply's full set. */
function ToolImages({ toolCallId }: { toolCallId: string }) {
  const browse = useReplyImages();
  const images = browse.filter((image) => image.toolCallId === toolCallId);
  return images.length > 0 ? <ImageGallery images={images} browse={browse}
    label={`${images.length} ${images.length === 1 ? "image" : "images"} from this tool`} /> : null;
}

function ToolBody({ view, input, output, labels = { input: "Input", output: "Output" }, children }:
  { view: ToolView; input: string; output: string; labels?: { input: string; output: string }; children?: ReactNode }) {
  const clipped = clipOutput(output);
  const empty = view === "interrupted" ? "No result. The run ended before this tool finished."
    : isLive(view) ? "Waiting for output." : "No output.";
  const outputLabel = view === "failed" ? "Error" : labels.output;
  return <>
    {input ? <section className="trace-section" aria-label={labels.input}>
      <h4 className="trace-heading">{labels.input}</h4>
      <pre className="trace-pre" tabIndex={0}>{input}</pre>
    </section> : null}
    <section className="trace-section" aria-label={outputLabel}>
      <h4 className="trace-heading">{outputLabel}</h4>
      {output ? <pre className="trace-pre" tabIndex={0} data-tone={view === "failed" ? "error" : undefined}>{clipped.text}</pre>
        : <p className="trace-empty">{empty}</p>}
      {clipped.hidden > 0 ? <p className="trace-empty">{clipped.hidden.toLocaleString()} more characters not shown.</p> : null}
      {children}
    </section>
  </>;
}

const skillLabels: Record<ToolView, string> = {
  pending: "loading skill", running: "loading skill", done: "loaded skill", failed: "failed to load skill", interrupted: "stopped loading skill",
};

/**
 * The agent reading a skill's SKILL.md. It names the instructions the agent now
 * follows, so it stays a visible record instead of joining the tool activity.
 */
export function SkillLoad({ toolName, args, result, isError, artifact }:
  Pick<ToolCallMessagePartProps, "toolName" | "args" | "result" | "isError" | "artifact">) {
  const skill = skillLoadOf(toolName, args);
  const view = toolView({ artifact, result, isError });
  return <Disclosure live={isLive(view)} label={skillLabels[view]} detail={skill?.name ?? toolName} className="skill-load"
    {...(view === "failed" ? { tone: "error" as const } : {})}>
    {(open) => open ? <ToolBody view={view} input={skill?.path ?? ""} output={outputText(result)}
      labels={{ input: "Path", output: "Skill text" }} /> : null}
  </Disclosure>;
}

/** Adjacent skill loads share one line that names every skill and counts failures and stops. */
export function SkillLoadGroup({ indices, running, children }: { indices: readonly number[]; running: boolean; children: ReactNode }) {
  // Selectors return primitives, so an unchanged summary does not re-render.
  const failed = useAuiState((s) => indices.filter((index) => {
    const part = s.message.parts[index];
    return part?.type === "tool-call" && part.isError === true && !part.isPreliminary;
  }).length);
  const stopped = useAuiState((s) => indices.filter((index) => {
    const part = s.message.parts[index];
    return part?.type === "tool-call" && isToolArtifact(part.artifact) && part.artifact.state === "interrupted";
  }).length);
  const names = useAuiState((s) => [...new Set(indices.flatMap((index) => {
    const part = s.message.parts[index];
    return part?.type === "tool-call" ? [skillLoadOf(part.toolName, part.args)?.name ?? part.toolName] : [];
  }))].join(", "));
  const label = `${running ? "loading" : "loaded"} ${indices.length} skills${failed > 0 ? `, ${failed} failed` : ""}${stopped > 0 ? `, ${stopped} stopped` : ""}:`;
  return <Disclosure live={running} label={label} detail={names} className="skill-loads"
    {...(failed > 0 ? { tone: "error" as const } : {})}>
    {() => children}
  </Disclosure>;
}

/** One step's own parts, as indices into the message's parts. */
export interface StepSection { id: string; thoughts: number[]; tools: number[] }
/**
 * One row of a reply's steps. A narrated step is its own row: the text that
 * introduced some calls, and the calls. Adjacent steps without text share one
 * row, so a run of silent work reads as one line instead of a stack of them.
 */
export interface ToolStepView {
  /** The first step's id. */
  id: string;
  /** Text parts the model wrote before the calls. Empty when it wrote none. */
  narration: number[];
  /** Each step in the row, in order. */
  sections: StepSection[];
  marks: TallyTone[];
  /** Stands in for absent narration. */
  line: string;
  /** Each tool name with its count, and the outcome. */
  title: string;
  /** The calls and their outcome, for the toggle's accessible name. */
  label: string;
  live: boolean;
}

type StepTool = Extract<PartState, { type: "tool-call" }>;
/** The step a part belongs to, from the `parentId` the transcript gives it. */
export const stepIdOf = (part: PartState): string | undefined => {
  const parentId = "parentId" in part ? part.parentId : undefined;
  return typeof parentId === "string" && parentId.startsWith(STEP_PREFIX) ? parentId.slice(STEP_PREFIX.length) : undefined;
};
const targetOf = (part: StepTool) => `${part.toolName} ${summarizeToolArgs(part.args)}`.trim();
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * A failed call counts as retried when a later call in the reply runs the
 * same tool on the same target and succeeds. The match is literal, so a fix
 * by another command stays a failure: the rule never hides an open failure.
 */
function toneOf(part: StepTool, later: readonly StepTool[]): TallyTone {
  const view = toolView(part);
  if (view === "pending" || view === "running") return "live";
  if (view === "interrupted") return "faint";
  if (view !== "failed") return "plain";
  const target = targetOf(part);
  return later.some((other) => targetOf(other) === target && toolView(other) === "done") ? "warn" : "bad";
}

interface RawStep extends StepSection { narration: number[]; first: number; last: number }

/** The rows of one reply, in order. Parts belong to a step through the `parentId` the transcript gives them. */
export function planToolSteps(parts: readonly PartState[]): ToolStepView[] {
  const steps = new Map<string, RawStep>();
  const calls: StepTool[] = [];
  parts.forEach((part, index) => {
    const id = stepIdOf(part);
    if (id === undefined) return;
    const step = steps.get(id) ?? { id, narration: [], thoughts: [], tools: [], first: index, last: index };
    steps.set(id, step);
    step.last = index;
    if (part.type === "text") step.narration.push(index);
    else if (part.type === "reasoning") step.thoughts.push(index);
    else if (part.type === "tool-call") { step.tools.push(index); calls.push(part); }
  });
  // A silent step joins the row before it when that row is silent too and
  // nothing sits between them, so merging never reorders the reply.
  const rows: RawStep[][] = [];
  for (const step of steps.values()) {
    if (step.tools.length === 0) continue;
    const row = rows.at(-1);
    const previous = row?.at(-1);
    if (row && previous && step.narration.length === 0 && row[0]!.narration.length === 0 && previous.last + 1 === step.first) row.push(step);
    else rows.push([step]);
  }
  return rows.map((row) => {
    const tools = row.flatMap((step) => step.tools.map((index) => parts[index] as StepTool));
    const marks = tools.map((part) => toneOf(part, calls.slice(calls.indexOf(part) + 1)));
    const count = (tone: TallyTone) => marks.filter((mark) => mark === tone).length;
    const outcome = [
      count("bad") > 0 ? `${count("bad")} failed` : "",
      count("warn") > 0 ? `${count("warn")} failed, then retried` : "",
      count("faint") > 0 ? `${count("faint")} stopped` : "",
    ].filter(Boolean).join(", ");
    const names = new Map<string, number>();
    for (const part of tools) names.set(part.toolName, (names.get(part.toolName) ?? 0) + 1);
    const counts = [...names].map(([name, n]) => n > 1 ? `${name} \u00d7${n}` : name).join(", ");
    const running = tools.find((part) => toneOf(part, []) === "live");
    // One step names its call; a run of steps names its tools, unless one is running now.
    const lead = running ?? (row.length === 1 ? tools[0] : undefined);
    const line = lead ? `${targetOf(lead)}${tools.length > 1 ? ` +${tools.length - 1}` : ""}` : counts;
    const calls_ = `${plural(tools.length, "tool call")}${row.length > 1 ? ` in ${row.length} steps` : ""}`;
    return {
      id: row[0]!.id, narration: row[0]!.narration,
      sections: row.map(({ id, thoughts, tools: own }) => ({ id, thoughts, tools: own })),
      marks, line,
      title: outcome ? `${counts} (${outcome})` : counts,
      label: `${calls_}${outcome ? `, ${outcome}` : ""}`,
      live: running !== undefined,
    };
  });
}

/**
 * The current reply's rows by first step id, and each step's row. The
 * selector returns text, so a reply re-renders when a step changes, not on
 * every streamed token.
 */
export function useToolSteps(): { rows: ReadonlyMap<string, ToolStepView>; rowOf: ReadonlyMap<string, string> } {
  const plan = useAuiState((s) => JSON.stringify(planToolSteps(s.message.parts)));
  return useMemo(() => {
    const views = JSON.parse(plan) as ToolStepView[];
    return { rows: new Map(views.map((view) => [view.id, view])),
      rowOf: new Map(views.flatMap((view) => view.sections.map((section) => [section.id, view.id] as const))) };
  }, [plan]);
}

/**
 * Consecutive reasoning and tools share one disclosure, without inferred steps
 * or timing. It is the only fold around them: reasoning inside reads as text,
 * and each tool is one line. The line counts failures and stops, so a closed
 * fold never hides one.
 */
export function ChainOfThoughtGroup({ indices, running, children }: { indices: readonly number[]; running: boolean; children: ReactNode }) {
  const failed = useAuiState((s) => indices.filter((index) => {
    const part = s.message.parts[index];
    return part?.type === "tool-call" && part.isError === true && !part.isPreliminary;
  }).length);
  const label = useAuiState((s) => {
    const parts = indices.flatMap((index) => s.message.parts[index] ? [s.message.parts[index]!] : []);
    const reasoning = parts.some((part) => part.type === "reasoning");
    const tools = parts.filter((part) => part.type === "tool-call");
    const stopped = tools.filter((part) => isToolArtifact(part.artifact) && part.artifact.state === "interrupted").length;
    const state = reasoning ? running ? "thinking" : "reasoning" : running ? "running tools" : "tool activity";
    return `${state}${failed > 0 ? `, ${failed} failed` : ""}${stopped > 0 ? `, ${stopped} stopped` : ""}`;
  });
  const detail = useAuiState((s) => {
    const tools = indices.flatMap((index) => {
      const part = s.message.parts[index];
      return part?.type === "tool-call" ? [part] : [];
    });
    if (tools.length === 0) return "";
    const current = running ? tools.findLast((part) => part.result === undefined || part.isPreliminary) : undefined;
    const count = `${tools.length} ${tools.length === 1 ? "tool" : "tools"}`;
    return current ? `${count}: ${current.toolName} ${summarizeToolArgs(current.args)}`.trim()
      : `${count}: ${[...new Set(tools.map((part) => part.toolName))].join(", ")}`;
  });
  return <Disclosure live={running} label={label} {...(detail ? { detail } : {})} className="chain-of-thought"
    {...(failed > 0 ? { tone: "error" as const } : {})}>
    {() => children}
  </Disclosure>;
}
