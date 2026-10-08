// Trace grammar adapted from assistant-ui's homepage demo (trace.tsx,
// trace-line.tsx). See THIRD_PARTY_NOTICES.md. Native <details> replaces the
// site's Collapsible so disclosures need no extra dependency.
import { useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { useState, type ReactNode } from "react";
import type { ToolArtifact, ToolState } from "../transcript";
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
