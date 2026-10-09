// Plain-text syntax for the rich blocks an agent can write in a reply. Each
// parser takes the body of one fenced block, possibly cut off mid-stream, and
// returns what it can read so far. Nothing here throws: unknown lines become
// text, so a malformed block still shows everything the agent wrote.

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];

/** The kind named by a GitHub alert marker (`[!WARNING]`), or undefined. */
export function calloutKind(marker: string): CalloutKind | undefined {
  const kind = marker.toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(kind) ? kind as CalloutKind : undefined;
}

const ALERT_MARKER = /^\[!([A-Za-z]+)\][ \t]*(?:\r?\n)?/;
// While a reply streams, the marker can arrive a few characters at a time.
// Streaming repair shows an unfinished "[!WAR" as "!WAR", so the bracket is
// optional here.
const PARTIAL_MARKER = /^(?:\[|\[?![A-Za-z]*)$/;

export type CalloutMarker =
  | { type: "kind"; kind: CalloutKind; length: number }
  | { type: "partial" };

/**
 * Reads the marker at the start of a blockquote's first text. Returns the kind
 * and how many characters to remove, "partial" for an unfinished marker that
 * is the whole text so far, or undefined for an ordinary quote.
 */
export function readCalloutMarker(text: string): CalloutMarker | undefined {
  const match = ALERT_MARKER.exec(text);
  if (match) {
    const kind = calloutKind(match[1]!);
    return kind === undefined ? undefined : { type: "kind", kind, length: match[0].length };
  }
  return PARTIAL_MARKER.test(text.trim()) && text.trim().length > 0 ? { type: "partial" } : undefined;
}

export type Step = { title: string; detail: string };

const STEP_MARKER = /^ ?(?:\d{1,3}[.)]|[-*+])(?:[ \t]+(.*))?$/;

/**
 * Splits a `steps` block into steps. A line that starts with a list marker
 * (`1.`, `-`) at the left edge starts a step and is its title. Following lines
 * up to the next marker are that step's detail, dedented, as Markdown.
 */
export function parseSteps(body: string): Step[] {
  const steps: { title: string; detail: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const marker = STEP_MARKER.exec(line);
    if (marker) { steps.push({ title: (marker[1] ?? "").trim(), detail: [] }); continue; }
    const current = steps.at(-1);
    if (current === undefined) {
      if (line.trim() !== "") steps.push({ title: line.trim(), detail: [] });
      continue;
    }
    current.detail.push(line);
  }
  return steps.map((step) => ({ title: step.title, detail: dedent(step.detail).trim() }));
}

export type CompareOption = { title: string; recommended: boolean; summary: string; pros: string[]; cons: string[] };
export type Comparison = { caption: string; options: CompareOption[] };

const OPTION_HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const RECOMMENDED = /[ \t]*\((?:recommended)\)[ \t]*$/i;
const PRO = /^\s*\+[ \t]+(.*)$/;
// "-", "−" (minus), or "–" (en dash): agents and keyboards produce all three.
const CON = /^\s*[-−–][ \t]+(.*)$/;

/**
 * Splits a `compare` block into options. A Markdown heading starts an option;
 * "(recommended)" at the end of it marks the pick. Inside an option, `+ ` lines
 * are strengths, `- ` lines are costs, and other lines are its summary. Text
 * before the first heading is the caption.
 */
export function parseComparison(body: string): Comparison {
  const caption: string[] = [];
  const options: { title: string; recommended: boolean; summary: string[]; pros: string[]; cons: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = OPTION_HEADING.exec(line);
    if (heading) {
      const title = heading[1] ?? "";
      options.push({ title: title.replace(RECOMMENDED, "").trim(), recommended: RECOMMENDED.test(title), summary: [], pros: [], cons: [] });
      continue;
    }
    const option = options.at(-1);
    if (option === undefined) { caption.push(line); continue; }
    const pro = PRO.exec(line);
    if (pro) { option.pros.push(pro[1]!.trim()); continue; }
    const con = CON.exec(line);
    if (con) { option.cons.push(con[1]!.trim()); continue; }
    option.summary.push(line);
  }
  return {
    caption: caption.join("\n").trim(),
    options: options.map((option) => ({ ...option, summary: option.summary.join("\n").trim() })),
  };
}

function dedent(lines: string[]): string {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)![0].length);
  const cut = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(cut)).join("\n");
}
