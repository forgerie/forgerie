import { useEffect, useRef } from "react";
import { MarkdownFragment } from "./MarkdownFragment";
import "./ExchangeLog.css";

export type ExchangeLine =
  /** Words: `in` came to the worker, `out` came from it. */
  | { kind: "said"; key: string; side: "in" | "out"; speaker: string; text: string; streaming?: boolean | undefined }
  /** An action the worker took, in one line. */
  | { kind: "call"; key: string; name: string; summary: string }
  /** What an action returned, folded by default. */
  | { kind: "output"; key: string; name: string; text: string; isError: boolean };

/**
 * Molecule: the running record of one worker, oldest first. Words read as
 * prose with the speaker in the margin; actions are one code-face line each;
 * their output opens on request, and a failure shows its first line. While
 * `follow` is on, new lines bring the end into view.
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
  const lastLength = last?.kind === "said" ? last.text.length : 0;
  useEffect(() => {
    if (follow && typeof end.current?.scrollIntoView === "function") end.current.scrollIntoView({ block: "end" });
  }, [follow, count, lastLength]);
  if (count === 0) return <p className="exchange-log-empty">{empty}</p>;
  return <div className="exchange-log">
    {lines.map((line) => {
      if (line.kind === "said") return <div key={line.key} className="exchange-log-said" data-side={line.side} data-streaming={line.streaming || undefined}>
        <span className="exchange-log-speaker">{line.speaker}</span>
        <div className="exchange-log-text"><MarkdownFragment text={line.text} /></div>
      </div>;
      if (line.kind === "call") return <div key={line.key} className="exchange-log-call">
        <span className="exchange-log-name">{line.name}</span>
        <code className="exchange-log-summary">{line.summary}</code>
      </div>;
      const first = line.text.split("\n", 1)[0] ?? "";
      return <details key={line.key} className="exchange-log-output" data-error={line.isError || undefined}>
        <summary className="exchange-log-output-line">{line.isError ? first || line.name : first === "" ? line.name : first}</summary>
        <pre className="exchange-log-output-text" tabIndex={0}>{line.text}</pre>
      </details>;
    })}
    <div ref={end} />
  </div>;
}
