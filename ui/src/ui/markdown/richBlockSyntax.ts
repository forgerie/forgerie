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

export type FileMark = "added" | "changed" | "deleted";
export type FileNode = { name: string; directory: boolean; mark?: FileMark; note: string; children: FileNode[] };

const MARKS: Record<string, FileMark> = { "+": "added", "~": "changed", "-": "deleted" };
const FILE_LINE = /^([ \t]*)(?:([+~-])[ \t]+)?(.*?)(?:[ \t]+#[ \t]+(.*))?$/;

/**
 * Builds a file tree from a `files` block. Each line is a path, optionally
 * marked `+` (added), `~` (changed) or `-` (deleted), with an optional
 * ` # note`. A path ending in `/` is a directory; deeper-indented lines under
 * it are inside it. A line may also hold a whole path (`src/ui/Diagram.tsx`).
 */
export function parseFileTree(body: string): FileNode[] {
  const root: FileNode = { name: "", directory: true, note: "", children: [] };
  const parents: { indent: number; node: FileNode }[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const match = FILE_LINE.exec(line.replace(/\t/g, "  "))!;
    const indent = match[1]!.length;
    const path = match[3]!.trim();
    if (path === "") continue;
    while (parents.length > 0 && parents.at(-1)!.indent >= indent) parents.pop();
    let node = parents.at(-1)?.node ?? root;
    const segments = path.split("/").filter((segment) => segment !== "");
    const directory = path.endsWith("/");
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1;
      const isDirectory = !last || directory;
      let child = node.children.find((candidate) => candidate.name === segment && candidate.directory === isDirectory);
      if (child === undefined) {
        child = { name: segment, directory: isDirectory, note: "", children: [] };
        node.children.push(child);
      }
      if (last) {
        const mark = match[2] === undefined ? undefined : MARKS[match[2]];
        if (mark !== undefined) child.mark = mark;
        if (match[4] !== undefined) child.note = match[4].trim();
      }
      node = child;
    });
    if (directory) parents.push({ indent, node });
  }
  return root.children.map(compactDirectories);
}

/** Joins a chain of unmarked single-child directories into one row (`src/ui/`). */
function compactDirectories(node: FileNode): FileNode {
  let current = node;
  while (current.directory && current.mark === undefined && current.note === ""
    && current.children.length === 1 && current.children[0]!.directory) {
    const only = current.children[0]!;
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return { ...current, children: current.children.map(compactDirectories) };
}

/** The full path of every file a tree names that could still be on disk: not a directory, not marked deleted. */
export function filePaths(nodes: readonly FileNode[], base = ""): string[] {
  return nodes.flatMap((node) => {
    const path = `${base}${node.name}${node.directory ? "/" : ""}`;
    const own = node.directory || node.mark === "deleted" ? [] : [path];
    return [...own, ...filePaths(node.children, path)];
  });
}

/** Whether any entry carries a change mark. A tree with none is a layout, not a change. */
export function hasMarks(nodes: readonly FileNode[]): boolean {
  return nodes.some((node) => node.mark !== undefined || hasMarks(node.children));
}

/** How many entries a tree holds below its top level: the files and folders a layout describes, not the folders it sits in. */
export function countEntries(nodes: readonly FileNode[]): number {
  const below = (list: readonly FileNode[]): number => list.reduce((sum, node) => sum + 1 + below(node.children), 0);
  return nodes.length === 1 && nodes[0]!.directory ? below(nodes[0]!.children) : below(nodes);
}

export function countMarks(nodes: FileNode[]): Record<FileMark, number> {
  const counts: Record<FileMark, number> = { added: 0, changed: 0, deleted: 0 };
  const walk = (list: FileNode[]) => { for (const node of list) { if (node.mark) counts[node.mark] += 1; walk(node.children); } };
  walk(nodes);
  return counts;
}

export const CHECK_STATES = ["done", "active", "todo", "failed", "skipped"] as const;
export type CheckState = typeof CHECK_STATES[number];
export type CheckItem = { state: CheckState; text: string; detail: string };
export type CheckList = { title: string; items: CheckItem[] };

const CHECK_MARKS: Record<string, CheckState> = { x: "done", X: "done", "~": "active", " ": "todo", "": "todo", "!": "failed", "-": "skipped" };
const CHECK_LINE = /^ ?(?:[-*][ \t]+)?\[([xX~!\- ]?)\](?:[ \t]+(.*))?$/;

/**
 * Reads a `status` block. `[x]` done, `[~]` in progress, `[ ]` to do,
 * `[!]` failed, `[-]` skipped. Indented lines under an item are its detail.
 * Text before the first item is the title.
 */
export function parseCheckList(body: string): CheckList {
  const title: string[] = [];
  const items: { state: CheckState; text: string; detail: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const check = CHECK_LINE.exec(line);
    if (check) { items.push({ state: CHECK_MARKS[check[1] ?? ""] ?? "todo", text: (check[2] ?? "").trim(), detail: [] }); continue; }
    const current = items.at(-1);
    if (current === undefined) { title.push(line); continue; }
    current.detail.push(line);
  }
  return { title: title.join(" ").trim(), items: items.map((item) => ({ ...item, detail: dedent(item.detail).trim() })) };
}

export type Fact = { label: string; value: string };
const FACT_LINE = /^\s*([^:]+?):[ \t]+(.+)$/;

/** Reads a `facts` block: one `Label: value` per line. Other lines are skipped. */
export function parseFacts(body: string): Fact[] {
  return body.split(/\r?\n/).flatMap((line) => {
    const fact = FACT_LINE.exec(line);
    return fact ? [{ label: fact[1]!.trim(), value: fact[2]!.trim() }] : [];
  });
}

/** How sure the writer is, then the four research verdicts on a source's claim. */
export const CONFIDENCES = ["verified", "inferred", "opinion", "unknown", "supported", "partly", "unsupported", "contradicted"] as const;
export type Confidence = typeof CONFIDENCES[number];
export type Claim = { confidence: Confidence; text: string; detail: string };
export type ClaimSet = { title: string; claims: Claim[] };

const CLAIM_LINE = /^ ?(?:[-*][ \t]+)?(verified|inferred|opinion|unknown|supported|partly|unsupported|contradicted)[ \t]*:[ \t]*(.*)$/i;

/**
 * Reads a `claims` block: `verified:`, `inferred:`, `opinion:` or `unknown:`
 * starts a claim, and so do the research verdicts `supported:`, `partly:`,
 * `unsupported:` and `contradicted:`. Lines under a claim are its evidence. Text before the first
 * claim is the title.
 */
export function parseClaims(body: string): ClaimSet {
  const title: string[] = [];
  const claims: { confidence: Confidence; text: string; detail: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const claim = CLAIM_LINE.exec(line);
    if (claim) { claims.push({ confidence: claim[1]!.toLowerCase() as Confidence, text: claim[2]!.trim(), detail: [] }); continue; }
    const current = claims.at(-1);
    if (current === undefined) { title.push(line); continue; }
    current.detail.push(line);
  }
  return { title: title.join(" ").trim(), claims: claims.map((claim) => ({ ...claim, detail: dedent(claim.detail).trim() })) };
}

export type Disclosure = { summary: string; body: string };

/** Reads a `details` block: the first non-empty line is the summary, the rest is the body. */
export function parseDisclosure(body: string): Disclosure {
  const lines = body.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return { summary: "", body: "" };
  return { summary: lines[first]!.trim(), body: dedent(lines.slice(first + 1)).trim() };
}

export type Command = { note: string; command: string };

/**
 * Reads a `commands` block. A `# ` line describes the command below it. A
 * leading `$ ` is dropped. A line that ends in `\` continues on the next line.
 */
export function parseCommands(body: string): Command[] {
  const commands: Command[] = [];
  let note: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    commands.push({ note: note.join(" "), command: pending.join("\n") });
    note = [];
    pending = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (pending.length > 0) {
      pending.push(line);
      if (!line.endsWith("\\")) flush();
      continue;
    }
    if (line.trim() === "") continue;
    const comment = /^\s*#(?:[ \t]+(.*))?$/.exec(line);
    if (comment) { note.push((comment[1] ?? "").trim()); continue; }
    pending.push(line.trim().replace(/^\$[ \t]+/, ""));
    if (!line.endsWith("\\")) flush();
  }
  // A command cut off mid-stream, or a last note still waiting for its command.
  if (pending.length > 0) flush();
  else if (note.length > 0) commands.push({ note: note.join(" "), command: "" });
  return commands;
}

export type Bar = { label: string; value: number; display: string };
export type BarSet = { title: string; bars: Bar[] };

const BAR_LINE = /^\s*([^:]+?):[ \t]*(.*\d.*)$/;
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

/**
 * Reads a `bars` block: one `Label: value` per line, where the value holds a
 * number and may hold a unit. A line before the first bar is the title.
 */
export function parseBars(body: string): BarSet {
  const title: string[] = [];
  const bars: Bar[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const bar = BAR_LINE.exec(line);
    const number = bar ? NUMBER.exec(bar[2]!) : null;
    if (bar && number) { bars.push({ label: bar[1]!.trim(), value: Number(number[0].replace(/,/g, "")), display: bar[2]!.trim() }); continue; }
    if (bars.length === 0) title.push(line.trim());
  }
  return { title: title.join(" "), bars };
}

export type Correction = { wrong: string; right: string; cause: string };

const CORRECTION_LINE = /^\s*(was|now|cause)[ \t]*:[ \t]*(.*)$/i;
const CORRECTION_FIELDS = { was: "wrong", now: "right", cause: "cause" } as const;

/**
 * Reads a `correction` block: `was:` what an earlier reply said, `now:` what
 * is true, `cause:` why the mistake happened. Lines under a field continue it.
 */
export function parseCorrection(body: string): Correction {
  const fields: Record<keyof Correction, string[]> = { wrong: [], right: [], cause: [] };
  let current: keyof Correction | undefined;
  for (const line of body.split(/\r?\n/)) {
    const field = CORRECTION_LINE.exec(line);
    if (field) { current = CORRECTION_FIELDS[field[1]!.toLowerCase() as keyof typeof CORRECTION_FIELDS]; fields[current].push(field[2]!); continue; }
    if (current !== undefined) fields[current].push(line);
  }
  const join = (lines: string[]) => lines.map((line) => line.trim()).join("\n").trim();
  return { wrong: join(fields.wrong), right: join(fields.right), cause: join(fields.cause) };
}

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = typeof SEVERITIES[number];
export type Aside = { severity: Severity; text: string; detail: string };

const ASIDE_LINE = /^ ?(?:[-*][ \t]+)?(high|medium|low)[ \t]*:[ \t]*(.*)$/i;

/** Reads an `asides` block: `high:`, `medium:` or `low:` starts an item; lines under it are its detail. */
export function parseAsides(body: string): Aside[] {
  const asides: { severity: Severity; text: string; detail: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const aside = ASIDE_LINE.exec(line);
    if (aside) { asides.push({ severity: aside[1]!.toLowerCase() as Severity, text: aside[2]!.trim(), detail: [] }); continue; }
    asides.at(-1)?.detail.push(line);
  }
  return asides.map((aside) => ({ ...aside, detail: dedent(aside.detail).trim() }));
}

export type TimelineEvent = { when: string; text: string; detail: string };
export type Timeline = { title: string; events: TimelineEvent[] };

// "18:22 - sessiond started": a spaced hyphen, en dash or em dash ends the time.
const EVENT_LINE = /^ ?(?:[-*][ \t]+)?(\S(?:.*?\S)?)[ \t]+[-–—][ \t]+(.*)$/;

/**
 * Reads a `timeline` block: `when - what` per line, in order. Lines indented
 * under an event are its detail. Text before the first event is the title.
 */
export function parseTimeline(body: string): Timeline {
  const title: string[] = [];
  const events: { when: string; text: string; detail: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const indented = /^[ \t]{2,}\S/.test(line);
    const event = indented && events.length > 0 ? null : EVENT_LINE.exec(line);
    if (event) { events.push({ when: event[1]!, text: event[2]!.trim(), detail: [] }); continue; }
    const current = events.at(-1);
    if (current === undefined) { title.push(line); continue; }
    current.detail.push(line);
  }
  return { title: title.join(" ").trim(), events: events.map((event) => ({ ...event, detail: dedent(event.detail).trim() })) };
}

// A quote's last line naming its source: "— src/app.ts:12" or "-- docs".
const SOURCE_LINE = /^(?:—|--)[ \t]+(\S.*)$/;

/** The source named by a line such as `— src/app.ts:12`, or undefined. */
export function readQuoteSource(line: string): string | undefined {
  return SOURCE_LINE.exec(line.trim())?.[1]?.trim();
}

// ---------------------------------------------------------------------------
// Round four: results, reviews, recaps, answers, commits, changes and money.
// A line before the first row is a title only once another line follows it:
// while a reply streams, the last line may be the first row still arriving.

/** Splits `fence` into lines, and keeps a title candidate only when it is not the last line. */
function titleAndRows<Row>(body: string, readRow: (line: string, rows: Row[]) => Row | undefined | "consumed"): { title: string; rows: Row[] } {
  const lines = body.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  let title = "";
  const rows: Row[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const row = readRow(line, rows);
    if (row === "consumed") return;
    if (row !== undefined) { rows.push(row); return; }
    if (rows.length === 0 && title === "" && index < lines.length - 1) title = line.trim();
  });
  return { title, rows };
}

/** `name — result`: a spaced em dash or `--` ends the name. */
function splitResult(text: string): { name: string; result: string } {
  const at = /[ \t](?:—|--)[ \t]/.exec(text);
  return at === null ? { name: text.trim(), result: "" } : { name: text.slice(0, at.index).trim(), result: text.slice(at.index + at[0].length).trim() };
}

export const RESULT_STATES = ["pass", "fail", "skip", "unchecked"] as const;
export type ResultState = typeof RESULT_STATES[number];
export type CheckResult = { state: ResultState; name: string; result: string };
export type CheckResultSet = { title: string; checks: CheckResult[] };

const RESULT_LINE = /^ ?(?:[-*][ \t]+)?(pass|fail|skip|unchecked)[ \t]*:[ \t]*(.*)$/i;

/**
 * Reads a `checks` block: `pass:`, `fail:`, `skip:` or `unchecked:` starts a
 * check, written `name — result`. A line before the first check is the title.
 */
export function parseCheckResults(body: string): CheckResultSet {
  const { title, rows } = titleAndRows<CheckResult>(body, (line) => {
    const match = RESULT_LINE.exec(line);
    return match ? { state: match[1]!.toLowerCase() as ResultState, ...splitResult(match[2]!) } : undefined;
  });
  return { title, checks: rows };
}

export const REVIEW_VERDICTS = ["approve", "changes", "blocked"] as const;
export type ReviewVerdict = typeof REVIEW_VERDICTS[number];
/** Worst first. `blocker` ranks with P0 and `should-fix` with P1. */
export const FINDING_RANKS: Record<string, { rank: number; severity: string }> = {
  p0: { rank: 0, severity: "P0" }, blocker: { rank: 0, severity: "Blocker" },
  p1: { rank: 1, severity: "P1" }, "should-fix": { rank: 1, severity: "Should fix" },
  p2: { rank: 2, severity: "P2" }, nit: { rank: 3, severity: "Nit" },
};
export type Finding = { rank: number; severity: string; where: string; problem: string; fix: string };
export type FindingSet = { verdict?: ReviewVerdict; findings: Finding[] };

const VERDICT_LINE = /^\s*verdict[ \t]*:[ \t]*(.*)$/i;
const FINDING_LINE = /^(?:[-*][ \t]+)?(P0|P1|P2|nit|blocker|should-fix)[ \t]+(\S+)(?:[ \t]+(?:—|--)[ \t]+(.*))?$/i;
const FIX_LINE = /^[ \t]+fix[ \t]*:[ \t]*(.*)$/i;

function readVerdict(word: string): ReviewVerdict | undefined {
  const text = word.trim().toLowerCase();
  if (text.startsWith("approve")) return "approve";
  if (text.startsWith("blocked")) return "blocked";
  if (text.startsWith("changes")) return "changes";
  return undefined;
}

/**
 * Reads a `findings` block: an optional `verdict: approve | changes needed |
 * blocked`, then one defect per line, `P1 path:line — problem`, with an
 * indented `fix:` under it. Defects come back worst first; equal ranks keep
 * the order they were written in.
 */
export function parseFindings(body: string): FindingSet {
  let verdict: ReviewVerdict | undefined;
  const findings: Finding[] = [];
  for (const line of body.split(/\r?\n/)) {
    const said = VERDICT_LINE.exec(line);
    if (said && findings.length === 0) { verdict = readVerdict(said[1]!) ?? verdict; continue; }
    const finding = FINDING_LINE.exec(line);
    if (finding) {
      const { rank, severity } = FINDING_RANKS[finding[1]!.toLowerCase()]!;
      findings.push({ rank, severity, where: finding[2]!, problem: (finding[3] ?? "").trim(), fix: "" });
      continue;
    }
    const fix = FIX_LINE.exec(line);
    const current = findings.at(-1);
    if (fix && current) current.fix = fix[1]!.trim();
  }
  const sorted = findings.map((finding, index) => ({ finding, index })).sort((a, b) => a.finding.rank - b.finding.rank || a.index - b.index);
  return { ...(verdict ? { verdict } : {}), findings: sorted.map(({ finding }) => finding) };
}

/** The path in a `path:line` location, for opening the file. */
export function findingPath(where: string): string {
  return where.replace(/:[\d,–-]+$/, "");
}

export type Recap = { goal: string; done: string[]; left: string[]; needs: string; next: string };

const RECAP_LINE = /^ ?(?:[-*][ \t]+)?(goal|done|left|needs you|next)[ \t]*:[ \t]*(.*)$/i;
const NOTHING = /^(?:nothing|none|no|-|—)\.?$/i;

/**
 * Reads a `recap` block: `goal:`, `done:` and `left:` (each may repeat),
 * `needs you:` and `next:`. `needs you: nothing` means nothing waits on the reader.
 */
export function parseRecap(body: string): Recap {
  const recap: Recap = { goal: "", done: [], left: [], needs: "", next: "" };
  for (const line of body.split(/\r?\n/)) {
    const match = RECAP_LINE.exec(line);
    if (!match) continue;
    const value = match[2]!.trim();
    switch (match[1]!.toLowerCase()) {
      case "goal": recap.goal = value; break;
      case "done": if (value !== "") recap.done.push(value); break;
      case "left": if (value !== "") recap.left.push(value); break;
      case "needs you": recap.needs = NOTHING.test(value) ? "" : value; break;
      case "next": recap.next = value; break;
    }
  }
  return recap;
}

export const ANSWERS = ["yes", "no", "partly"] as const;
export type Answer = typeof ANSWERS[number];
export type Verdict = { answer: Answer; reason: string };

const ANSWER_LINE = /^\s*(yes|no|partly)[ \t]*:[ \t]*([\s\S]*)$/i;

/** Reads a `verdict` block: `yes:`, `no:` or `partly:` and the reason. Nothing until the answer word and its colon arrive. */
export function parseVerdict(body: string): Verdict | undefined {
  const match = ANSWER_LINE.exec(body.trim());
  if (!match) return undefined;
  return { answer: match[1]!.toLowerCase() as Answer, reason: match[2]!.split(/\r?\n/).map((line) => line.trim()).join(" ").trim() };
}

export const SHIP_STATES = ["local", "pushed", "landed", "deployed"] as const;
export type ShipState = typeof SHIP_STATES[number];
export type Revision = { hash: string; state: ShipState; subject: string };
export type RevisionSet = { title: string; revisions: Revision[] };

const REVISION_LINE = /^ ?(?:[-*][ \t]+)?`?([0-9a-f]{7,40})`?[ \t]+(local|pushed|landed|deployed)(?:[ \t]+(.*))?$/i;

/** Reads a `commits` block: `hash state subject`, the state one of local, pushed, landed or deployed. */
export function parseRevisions(body: string): RevisionSet {
  const { title, rows } = titleAndRows<Revision>(body, (line) => {
    const match = REVISION_LINE.exec(line);
    return match ? { hash: match[1]!, state: match[2]!.toLowerCase() as ShipState, subject: (match[3] ?? "").trim() } : undefined;
  });
  return { title, revisions: rows };
}

export type Direction = "lower" | "higher" | "";
export type DeltaRow = { direction: Direction; label: string; before: string; after: string };
export type DeltaSet = { title: string; rows: DeltaRow[] };
export type DeltaMeaning = "better" | "worse" | "same" | "none";
export type DeltaChange =
  | { complete: false }
  | { complete: true; change: number; places: number; percent: number | "from zero" | "crosses zero"; meaning: DeltaMeaning };

const DELTA_LINE = /^ ?(?:[-*][ \t]+)?(?:(lower|higher)[ \t]*:[ \t]*)?(.+?):[ \t]*(\S+)[ \t]*(?:->|→)[ \t]*(\S*)[ \t]*$/i;

/** Reads a `delta` block: `lower:` or `higher:` (which way is better), then `label: before -> after`. */
export function parseDelta(body: string): DeltaSet {
  return titleAndRows<DeltaRow>(body, (line) => {
    const match = DELTA_LINE.exec(line);
    return match ? { direction: (match[1]?.toLowerCase() ?? "") as Direction, label: match[2]!.trim(), before: match[3]!, after: match[4]! } : undefined;
  });
}

const toNumber = (text: string) => text === "" ? Number.NaN : Number(text.replace(/,/g, "").replace(/^−/, "-").replace(/[^\d.+-].*$/, ""));
const places = (text: string) => (/\.(\d+)/.exec(text)?.[1] ?? "").length;

/** What a row's change is and whether it is good, once both numbers are in. */
export function deltaChange(row: DeltaRow): DeltaChange {
  const before = toNumber(row.before);
  const after = toNumber(row.after);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return { complete: false };
  const change = after - before;
  const percent = before === 0 ? "from zero" : after !== 0 && Math.sign(before) !== Math.sign(after) ? "crosses zero" : (change / Math.abs(before)) * 100;
  const meaning: DeltaMeaning = change === 0 ? "same" : row.direction === "" ? "none" : (change < 0) === (row.direction === "lower") ? "better" : "worse";
  return { complete: true, change, places: Math.max(places(row.before), places(row.after)), percent, meaning };
}

export type LedgerRow = { label: string; amount: string; total: boolean };
export type LedgerSet = { title: string; rows: LedgerRow[] };

const LEDGER_LINE = /^ ?(=[ \t]*)?(.+?):(?:[ \t]+(.*))?$/;

/**
 * Reads a `ledger` block: `label: amount` per line, `= label: amount` for a
 * total. An amount may be a range (`$131.30 to -$68.70`); `?` says there is
 * none. A line before the first row is the title.
 */
export function parseLedger(body: string): LedgerSet {
  return titleAndRows<LedgerRow>(body, (line) => {
    const match = LEDGER_LINE.exec(line);
    return match ? { label: match[2]!.trim(), amount: (match[3] ?? "").trim(), total: match[1] !== undefined } : undefined;
  });
}
