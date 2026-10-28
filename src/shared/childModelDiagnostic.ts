import type { Message } from "@earendil-works/pi-ai";

export const CHILD_MODEL_CONTINUE = "Continue where you stopped; the previous model was unavailable.";
const LEGACY_RETRY_PREFIX = "Continue where you stopped; the last request failed with:";

/** Bound work before any regex. Keep only complete tokens/quoted values when the input is clipped. */
function diagnosticInput(text: string): string {
  if (text.length <= 4096) return text;
  const prefix = text.slice(0, 4096);
  let boundary = 0; let quote = ""; let escaped = false;
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index];
    if (escaped) { escaped = false; continue; }
    if (quote !== "") {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === " " || char === "\n" || char === "\r" || char === "\t") boundary = index + 1;
  }
  return `${prefix.slice(0, boundary)} [truncated]`;
}

/** Outbound provider diagnostics are untrusted: redact before truncating, including tokens across the cut. */
export function childModelDiagnostic(text: string): string {
  const redacted = diagnosticInput(text).replace(/\p{Cf}/gu, "")
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']{1,4096}/gi, (url) => url.replace(/\/\/[^/\s]*@/, "//[redacted]@").replace(/[?#].*$/, "?[redacted]"))
    .replace(/\bsk-[A-Za-z0-9_-]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s"',;<>]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key)(["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&,;<>]+)/gi, "$1$2[redacted]")
    .replace(/[a-f0-9]{32,}/gi, "[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, "[redacted]")
    .replace(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim();
  return redacted.length <= 300 ? redacted : `${redacted.slice(0, 299)}…`;
}

/** Scrub old retry inputs and defensively scrub failed messages; Durable currently excludes failed assistant entries. */
export function childModelDiagnosticContext(messages: readonly Message[]): Message[] {
  return messages.map((message) => message.role === "assistant" && message.stopReason === "error"
    ? { ...message, content: [], ...(message.errorMessage === undefined ? {} : { errorMessage: childModelDiagnostic(message.errorMessage) }) }
    : message.role === "user" && typeof message.content === "string" && message.content.startsWith(LEGACY_RETRY_PREFIX)
      ? { ...message, content: CHILD_MODEL_CONTINUE } : message);
}

/** Compaction's SDK hook cannot replace source messages. Decline rather than send an unsafe error to its model. */
export function hasUnsafeChildModelDiagnostic(messages: readonly Message[]): boolean {
  return messages.some((message) => (message.role === "assistant" && message.stopReason === "error"
    && (message.content.length > 0 || (message.errorMessage !== undefined && childModelDiagnostic(message.errorMessage) !== message.errorMessage)))
    || (message.role === "user" && typeof message.content === "string" && message.content.startsWith(LEGACY_RETRY_PREFIX)));
}

/** Migrate pending reports written before diagnostics were scrubbed, without truncating a child's answer. */
export function childModelDiagnosticReport(report: string): string {
  const marker = ", no reply needed]";
  const end = report.startsWith("[subagent ") ? report.indexOf(marker) : -1;
  return end === -1 ? childModelDiagnostic(report)
    : childModelDiagnostic(report.slice(0, end + marker.length)) + report.slice(end + marker.length);
}
