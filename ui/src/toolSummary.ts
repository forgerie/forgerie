/**
 * One-line description of a tool call's arguments. Ported from Forgerie's
 * server `summarizeToolArgs` so history and live calls read the same way.
 */
export function summarizeToolArgs(args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args == null ? "" : shortValue(args);
  const record = args as Record<string, unknown>;
  if (typeof record["command"] === "string") return record["command"];
  if (typeof record["path"] === "string") return record["path"];
  if (typeof record["oldText"] === "string" && typeof record["newText"] === "string") return "edit text replacement";
  const edits = record["edits"];
  if (Array.isArray(edits)) return `${edits.length} edit${edits.length === 1 ? "" : "s"}`;
  return Object.entries(record).filter(([, value]) => value != null).slice(0, 3)
    .map(([key, value]) => `${key}: ${shortValue(value)}`).join(", ");
}
function shortValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** Argument text for the expanded view: a shell command as-is, anything else as JSON. */
export function formatToolArgs(args: unknown): string {
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    const keys = Object.keys(record);
    if (typeof record["command"] === "string" && keys.every((key) => key === "command" || key === "timeout")) return record["command"];
  }
  return args === undefined ? "" : JSON.stringify(args, null, 2) ?? "";
}

export const OUTPUT_LIMIT = 16_000;
/** Bounds rendered output. Very large results stay readable without a huge DOM. */
export function clipOutput(output: string, limit = OUTPUT_LIMIT): { text: string; hidden: number } {
  return output.length <= limit ? { text: output, hidden: 0 } : { text: output.slice(0, limit), hidden: output.length - limit };
}
