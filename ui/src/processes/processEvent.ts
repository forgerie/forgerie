// The managed-process events pi-processes writes into a session as
// `ad-process:notification` custom messages. Each carries one
// `<process_event>` element. This file is the only reader of that format.

export const PROCESS_EVENT_TYPE = "ad-process:notification";

export type ProcessOutcome = "succeeded" | "failed" | "stopped" | "matched";

export interface ProcessEvent {
  outcome: ProcessOutcome;
  id: string;
  name: string;
  /** One sentence from pi-processes, kept for screen readers and copy. */
  summary: string;
  command?: string;
  exitCode?: number;
  signal?: string;
  /** "after 12s" from the summary, when present. */
  duration?: string;
  /** log_match only: the output line that matched, and what was watched for. */
  matchedLine?: string;
  pattern?: string;
  stream?: string;
  /** Epoch milliseconds of the message, when known. */
  at?: number;
  /** How many matches of the same process this one stands for. */
  repeats: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, name: string) =>
  name.startsWith("#x") || name.startsWith("#X") ? String.fromCodePoint(parseInt(name.slice(2), 16))
    : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? `&${name};`);
const attribute = (attributes: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match ? decode(match[1]!) : undefined;
};
const child = (body: string, name: string) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(body);
  return match ? decode(match[1]!) : undefined;
};

/** "145s" reads as "2m 25s": a reader counts minutes, not a pile of seconds. Other forms pass through. */
export function readableDuration(text: string): string {
  const match = /^(\d+)s$/.exec(text);
  if (!match) return text;
  const total = Number(match[1]);
  if (total < 60) return text;
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", seconds ? `${seconds}s` : ""].filter(Boolean).join(" ");
}

/** Reads one event, or undefined when the text is not a process event this app knows. */
export function parseProcessEvent(text: string, at?: number): ProcessEvent | undefined {
  const root = /<process_event\b([^>]*)>([\s\S]*?)<\/process_event>/.exec(text);
  if (!root) return undefined;
  const [, attributes = "", body = ""] = root;
  const type = attribute(attributes, "type");
  const kind = attribute(attributes, "kind");
  const outcome: ProcessOutcome | undefined = type === "log_match" ? "matched"
    : kind === "success" ? "succeeded" : kind === "crash" ? "failed" : kind === "killed" ? "stopped" : undefined;
  const id = attribute(attributes, "process_id");
  if (outcome === undefined || id === undefined) return undefined;
  const summary = child(body, "summary")?.trim() ?? "";
  const exit = child(body, "exit_code");
  const signal = /<signal\b[^>]*\bname="([^"]+)"/.exec(body)?.[1];
  const pattern = /<pattern\b[^>]*>([\s\S]*?)<\/pattern>/.exec(body)?.[1];
  const event: ProcessEvent = { outcome, id, name: attribute(attributes, "process_name") ?? id, summary, repeats: 1 };
  const command = child(body, "command");
  if (command !== undefined) event.command = command;
  if (exit !== undefined && /^-?\d+$/.test(exit.trim())) event.exitCode = Number(exit);
  if (signal !== undefined) event.signal = signal;
  const duration = / after ([\dhms. ]+?)\.?$/.exec(summary)?.[1];
  if (duration !== undefined) event.duration = readableDuration(duration.trim());
  const matchedLine = child(body, "matched_line");
  if (matchedLine !== undefined) event.matchedLine = matchedLine.trim();
  if (pattern !== undefined) event.pattern = decode(pattern);
  const stream = child(body, "stream");
  if (stream !== undefined) event.stream = stream;
  if (at !== undefined) event.at = at;
  return event;
}

// Shell conventions. A code not listed shows as its number alone.
const EXIT_MEANINGS: Record<number, string> = {
  1: "The command reported an error.",
  2: "The command was used wrongly.",
  126: "The command was found but could not run.",
  127: "The shell could not find the command.",
  130: "It was interrupted (Ctrl-C).",
  137: "It was killed, often for running out of memory.",
  139: "It crashed with a memory fault.",
  143: "It was told to stop (SIGTERM).",
};
export const exitMeaning = (code: number | undefined) => code === undefined ? undefined : EXIT_MEANINGS[code];

/** What happened, in a few words after the process name. */
export function eventPhrase(event: ProcessEvent): string {
  switch (event.outcome) {
    case "matched": return event.repeats > 1 ? `printed a watched line ${event.repeats} times` : "printed a watched line";
    case "succeeded": return event.duration ? `succeeded in ${event.duration}` : "succeeded";
    case "stopped": return event.signal ? `stopped (${event.signal})` : "stopped";
    case "failed": return event.exitCode === undefined ? "failed" : `failed with exit code ${event.exitCode}`;
  }
}

/**
 * Joins runs of log matches from one process into the latest match, counted,
 * so a chatty dev server takes one line. Anything else between them ends the run.
 */
export function foldProcessEvents<T extends { processEvent?: ProcessEvent | undefined }>(messages: readonly T[]): readonly T[] {
  const out: T[] = [];
  for (const message of messages) {
    const event = message.processEvent;
    const previous = out.at(-1)?.processEvent;
    if (event?.outcome === "matched" && previous?.outcome === "matched" && previous.id === event.id) {
      out[out.length - 1] = { ...message, processEvent: { ...event, repeats: previous.repeats + event.repeats } };
      continue;
    }
    out.push(message);
  }
  return out.length === messages.length ? messages : out;
}
