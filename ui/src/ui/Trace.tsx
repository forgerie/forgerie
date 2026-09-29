// Trace grammar adapted from assistant-ui's homepage demo (trace.tsx,
// trace-line.tsx). See THIRD_PARTY_NOTICES.md. Native <details> replaces the
// site's Collapsible so disclosures need no extra dependency.
import { useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { useState, type ReactNode } from "react";
import type { ToolArtifact, ToolState } from "../transcript";
import { clipOutput, formatToolArgs, summarizeToolArgs } from "../toolSummary";

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
export function ToolCall({ toolName, args, result, isError, artifact }:
  Pick<ToolCallMessagePartProps, "toolName" | "args" | "result" | "isError" | "artifact">) {
  const view = toolView({ artifact, result, isError });
  const summary = summarizeToolArgs(args);
  return <Disclosure live={isLive(view)} label={toolLabels[view]} detail={summary ? `${toolName} ${summary}` : toolName}
    className="tool-call" {...(view === "failed" ? { tone: "error" as const } : {})}>
    {(open) => open ? <ToolBody view={view} input={formatToolArgs(args)} output={outputText(result)} /> : null}
  </Disclosure>;
}

function ToolBody({ view, input, output }: { view: ToolView; input: string; output: string }) {
  const clipped = clipOutput(output);
  const empty = view === "interrupted" ? "No result. The run ended before this tool finished."
    : isLive(view) ? "Waiting for output." : "No output.";
  return <>
    {input ? <section className="trace-section" aria-label="Input">
      <h4 className="trace-heading">Input</h4>
      <pre className="trace-pre" tabIndex={0}>{input}</pre>
    </section> : null}
    <section className="trace-section" aria-label="Output">
      <h4 className="trace-heading">{view === "failed" ? "Error" : "Output"}</h4>
      {output ? <pre className="trace-pre" tabIndex={0} data-tone={view === "failed" ? "error" : undefined}>{clipped.text}</pre>
        : <p className="trace-empty">{empty}</p>}
      {clipped.hidden > 0 ? <p className="trace-empty">{clipped.hidden.toLocaleString()} more characters not shown.</p> : null}
    </section>
  </>;
}

/**
 * Adjacent tool calls collapse into one line that names what ran. Failures are
 * counted on the line, so a collapsed group never hides one.
 */
export function ToolGroup({ indices, running, children }: { indices: readonly number[]; running: boolean; children: ReactNode }) {
  const failed = useAuiState((s) => indices.filter((index) => {
    const part = s.message.parts[index];
    return part?.type === "tool-call" && part.isError === true && !part.isPreliminary;
  }).length);
  const detail = useAuiState((s) => {
    const tools = indices.flatMap((index) => {
      const part = s.message.parts[index];
      return part?.type === "tool-call" ? [part] : [];
    });
    const current = running ? tools.findLast((part) => part.result === undefined || part.isPreliminary) : undefined;
    if (current) return `${current.toolName} ${summarizeToolArgs(current.args)}`.trim();
    return [...new Set(tools.map((part) => part.toolName))].join(", ");
  });
  const label = `${running ? "running" : "ran"} ${indices.length} tools${failed > 0 ? `, ${failed} failed` : ""}:`;
  return <Disclosure live={running} label={label} detail={detail} className="tool-group"
    {...(failed > 0 ? { tone: "error" as const } : {})}>
    {() => children}
  </Disclosure>;
}

/** Model reasoning, collapsed by default. */
export function ReasoningGroup({ running, children }: { running: boolean; children: ReactNode }) {
  return <Disclosure live={running} label={running ? "thinking" : "reasoning"} className="reasoning">
    {() => <div className="reasoning-text">{children}</div>}
  </Disclosure>;
}
