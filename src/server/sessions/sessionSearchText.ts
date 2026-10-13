import { searchQueryTerms, type MatchedPassage } from "../../shared/sessionSearch.js";

export type SearchMessage = Omit<MatchedPassage, "marks">;

export class SessionSearchError extends Error {
  constructor(readonly code: "query_too_short" | "index_unavailable" | "invalid_request", message: string) {
    super(message);
  }
}

export function parseSearchQuery(query: string): { terms: string[]; fts: string } {
  const unique = searchQueryTerms(query);
  if (unique.length === 0) throw new SessionSearchError("query_too_short", "Use at least one term with at least 3 characters");
  return { terms: unique, fts: unique.map((value) => `"${value.replaceAll('"', '""')}"`).join(" OR ") };
}

export function searchRecord(value: unknown): Record<string, unknown> | undefined {
  return isSearchRecord(value) ? value : undefined;
}

export function extractSearchMessage(value: unknown): SearchMessage | undefined {
  const entry = searchRecord(value);
  if (entry?.["type"] !== "message" || typeof entry["id"] !== "string") return undefined;
  const message = searchRecord(entry["message"]);
  const role = message?.["role"];
  if (role !== "user" && role !== "assistant") return undefined;
  const content = message?.["content"];
  let text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((part: unknown) => {
    const block = searchRecord(part);
    return block?.["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [];
  }).join("\n") : "";
  if (role === "user") text = text.replace(/<(skill|file)\b[^>]*>[\s\S]*?<\/\1\s*>/gu, "");
  if (text.trim() === "") return undefined;
  const timestamp = entry["timestamp"] ?? message?.["timestamp"];
  return { entryId: entry["id"], role, text, timestamp: typeof timestamp === "string" ? timestamp : typeof timestamp === "number" ? new Date(timestamp).toISOString() : "" };
}

export function searchPassage(message: SearchMessage, terms: readonly string[]): MatchedPassage {
  const lower = message.text.toLowerCase();
  const offsets = caseFoldOffsets(message.text, lower);
  const sourceStart = (at: number) => offsets?.[at] ?? at;
  const sourceEnd = (at: number) => offsets === undefined ? at : at === 0 ? 0 : (offsets[at - 1] ?? at - 1) + 1;
  const first = Math.min(...terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0));
  const start = Math.max(0, sourceStart(first) - 80);
  const text = message.text.slice(start, start + 240);
  const ranges: [number, number][] = [];
  // Search the small source window, but retain full-string folding coordinates.
  const foldedStart = offsets === undefined ? start : message.text.slice(0, start).toLowerCase().length;
  for (const term of terms) {
    let at = lower.indexOf(term, foldedStart);
    while (at >= 0 && sourceStart(at) < start + text.length) {
      ranges.push([sourceStart(at) - start, Math.min(text.length, sourceEnd(at + term.length) - start)]);
      at = lower.indexOf(term, at + 1);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const marks: [number, number][] = [];
  for (const range of ranges) {
    const last = marks.at(-1);
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else marks.push(range);
  }
  return { entryId: message.entryId, role: message.role, timestamp: message.timestamp, text, marks };
}

function caseFoldOffsets(source: string, folded: string): number[] | undefined {
  if (source.length === folded.length) return undefined;
  const offsets: number[] = [];
  let sourceAt = 0;
  for (const char of source) {
    const lower = char.toLowerCase();
    for (let at = 0; at < lower.length; at++) offsets.push(sourceAt + Math.min(at, char.length - 1));
    sourceAt += char.length;
  }
  offsets.push(source.length);
  return offsets;
}

function isSearchRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
