// A child's record as ExchangeLog lines. Shared by the child agents panel and a workflow's worker pane, so a worker's
// record reads the same in both.
import { createElement } from "react";
import type { ExchangeLine } from "../ui/ExchangeLog";
import { QuestionCard } from "../ui/QuestionCard";
import { QUESTION_TOOL, childLines, type ChildTranscript } from "./childAgentsModel";

const ANSWERED = /^The user answered: ([\s\S]*)$/u;

/**
 * The record as lines. The first message is the task; later ones are messages. A question the child asked is a card
 * where it asked, answered or open, instead of a tool call and its result.
 */
export function exchangeLines(name: string, transcript: ChildTranscript): ExchangeLine[] {
  let inputs = 0;
  const lines = childLines(transcript);
  const out: ExchangeLine[] = [];
  lines.forEach((line, index) => {
    if (line.kind === "said" && line.who === "message") { out.push({ kind: "in", key: line.key, label: inputs++ === 0 ? "Task" : "Message", text: line.text }); return; }
    if (line.kind === "said") { out.push({ kind: "out", key: line.key, text: line.text, streaming: line.streaming }); return; }
    if (line.kind === "tool" && line.name === QUESTION_TOOL) {
      const next = lines[index + 1];
      const answer = next?.kind === "result" && next.name === QUESTION_TOOL ? ANSWERED.exec(next.text)?.[1] : undefined;
      out.push({ kind: "block", key: line.key, content: createElement(QuestionCard, { asker: `${name} asks`, question: line.summary,
        answer, closedReason: next?.kind === "result" && next.isError ? "Question ended without an answer." : undefined }) });
      return;
    }
    if (line.kind === "result" && line.name === QUESTION_TOOL) return;
    if (line.kind === "tool") { out.push({ kind: "call", key: line.key, name: line.name, summary: line.summary, ...(line.riskLabel === undefined ? {} : {riskLabel: line.riskLabel}) }); return; }
    out.push({ kind: "output", key: line.key, name: line.name, text: line.text, isError: line.isError });
  });
  return out;
}
