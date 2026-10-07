import { parsePromptDiffAnnotations, type PromptDiffAnnotation } from "../../shared/promptDiffAnnotations.js";

/**
 * The HTTP boundary reduces annotations to one immutable prompt, so existing
 * transcript, deduplication, steering, and compaction delivery use the same text.
 * Snippets are caller-supplied snapshots, not current-file verification.
 */
export function composeDiffAnnotationPrompt(text: unknown, value: unknown): unknown {
  const annotations = parsePromptDiffAnnotations(value);
  if (annotations.length === 0) return text;
  if (text !== undefined && typeof text !== "string") throw new Error("Prompt text must be a string.");
  return [
    ...(text === undefined || text === "" ? [] : [text]),
    "Review notes below quote captured diff lines, not the current working tree.",
    ...annotations.map(formatAnnotation),
  ].join("\n\n");
}

function formatAnnotation(annotation: PromptDiffAnnotation): string {
  const oldNumbers: number[] = [];
  const newNumbers: number[] = [];
  const excerpt = annotation.lines.map((line) => {
    if ("oldLineNumber" in line) oldNumbers.push(line.oldLineNumber);
    if ("newLineNumber" in line) newNumbers.push(line.newLineNumber);
    const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
    return `${prefix}${line.text}`;
  }).join("\n");
  let longestRun = 0;
  for (const match of excerpt.matchAll(/`+/g)) longestRun = Math.max(longestRun, match[0].length);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [
    `Review note on ${JSON.stringify(annotation.path)} (${annotation.staged ? "staged" : "unstaged"} diff; ${rangeLabel("old", oldNumbers)}; ${rangeLabel("new", newNumbers)}):`,
    `Old/new positions by excerpt row: ${annotation.lines.map((line) => `${"oldLineNumber" in line ? String(line.oldLineNumber) : "-"}/${"newLineNumber" in line ? String(line.newLineNumber) : "-"}`).join(", ")}.`,
    `${fence}diff`,
    excerpt,
    fence,
    "",
    annotation.comment,
  ].join("\n");
}

function rangeLabel(side: string, numbers: readonly number[]): string {
  const first = numbers[0];
  if (first === undefined) return `no ${side} lines`;
  const last = numbers.at(-1);
  return first === last ? `${side} line ${String(first)}` : `${side} lines ${String(first)}-${String(last)}`;
}
