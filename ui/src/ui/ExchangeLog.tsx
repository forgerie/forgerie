import type { RiskLabel } from "@shared/riskLabels";
import { useEffect, useRef, type ReactNode } from "react";
import { MarkdownFragment } from "./MarkdownFragment";
import { RailSection } from "./RailSection";
import "./ExchangeLog.css";

export type ExchangeLine =
  /** Words to the worker: a task or a message. Drawn as a bubble at the end edge, like a user message. */
  | { kind: "in"; key: string; label: string; text: string }
  /** Words from the worker, drawn as prose. */
  | { kind: "out"; key: string; text: string; streaming?: boolean | undefined }
  /** An action the worker took, in one line. */
  | { kind: "call"; key: string; name: string; summary: string; riskLabel?: RiskLabel }
  /** What an action returned, folded by default. */
  | { kind: "output"; key: string; name: string; text: string; isError: boolean }
  /** Something the owner draws in the flow, such as a card. */
  | { kind: "block"; key: string; content: ReactNode };

type Block = { kind: "in" | "out" | "block"; line: ExchangeLine } | { kind: "work"; key: string; lines: ExchangeLine[] };

/** Consecutive actions and their output share one rail, as a reply's work does. */
function blocks(lines: readonly ExchangeLine[]): Block[] {
  const out: Block[] = [];
  for (const line of lines) {
    if (line.kind === "in" || line.kind === "out" || line.kind === "block") { out.push({ kind: line.kind, line }); continue; }
    const last = out.at(-1);
    if (last?.kind === "work") last.lines.push(line);
    else out.push({ kind: "work", key: line.key, lines: [line] });
  }
  return out;
}

function work(line: ExchangeLine): ReactNode {
  if (line.kind === "call") return <div key={line.key} className="exchange-log-call" data-risk-label={line.riskLabel === undefined ? undefined : JSON.stringify(line.riskLabel)}>
    <span className="exchange-log-name">{line.name}</span>
    <span className="exchange-log-summary">{line.summary}</span>
  </div>;
  if (line.kind !== "output") return null;
  const first = line.text.split("\n", 1)[0]?.trim() ?? "";
  return <details key={line.key} className="exchange-log-output" data-error={line.isError || undefined}>
    <summary className="exchange-log-output-line">{first === "" ? `${line.name} returned nothing` : first}</summary>
    <pre className="exchange-log-output-text" tabIndex={0}>{line.text}</pre>
  </details>;
}

/**
 * Molecule: the running record of one worker, oldest first, in the grammar
 * of a conversation. Words to the worker are bubbles at the end edge; its
 * words are prose; its actions hang from a rail, one line each, with output
 * folded and set in under its action. The owner may place a block in the
 * flow, such as a question card where the question was asked. While `follow` is on, new lines bring the end into view.
 */
export function ExchangeLog({ lines, follow = false, empty }: {
  lines: readonly ExchangeLine[];
  follow?: boolean;
  /** Shown when there are no lines yet. */
  empty: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = lines.length;
  const last = lines.at(-1);
  const lastLength = last?.kind === "out" ? last.text.length : 0;
  useEffect(() => {
    if (!follow) return;
    // After paint: an owner such as a dialog may lay the log out only once its own effects ran.
    const frame = requestAnimationFrame(() => { end.current?.scrollIntoView?.({ block: "end" }); });
    return () => cancelAnimationFrame(frame);
  }, [follow, count, lastLength]);
  if (count === 0) return <p className="exchange-log-empty">{empty}</p>;
  return <div className="exchange-log">
    {blocks(lines).map((block) => {
      if (block.kind === "work") return <RailSection key={`w${block.key}`}>{block.lines.map(work)}</RailSection>;
      const line = block.line;
      if (line.kind === "block") return <div key={line.key} className="exchange-log-block">{line.content}</div>;
      if (line.kind === "in") return <div key={line.key} className="exchange-log-in">
        <span className="exchange-log-label">{line.label}</span>
        <div className="exchange-log-bubble"><MarkdownFragment text={line.text} /></div>
      </div>;
      if (line.kind !== "out") return null;
      return <div key={line.key} className="exchange-log-out" data-streaming={line.streaming || undefined}>
        <MarkdownFragment text={line.text} />
      </div>;
    })}
    <div ref={end} />
  </div>;
}
