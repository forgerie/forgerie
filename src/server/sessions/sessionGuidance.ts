import {
  DEFAULT_SESSION_GUIDANCE_IDS,
  isSessionGuidanceId,
  normalizeSessionGuidanceIds,
  type SessionGuidanceId,
} from "../../shared/sessionGuidance.js";

export const SESSION_GUIDANCE_CUSTOM_TYPE = "forgerie.session-guidance";
const SESSION_GUIDANCE_VERSION = 1;

const instructions = {
  "technical-english": [
    "Use ASD-STE100 Simplified Technical English in all responses.",
    "This rule also applies to required templates and technical reports.",
    "Use sentences of 20 words or fewer when practical.",
    "Put one idea in each sentence.",
    "Use plain words.",
    "Use one term for each concept.",
    "Explain necessary technical terms when you first use them.",
    "Before sending, split sentences that contain more than one action, cause, result, or qualification.",
    "Before sending, replace any second word you used for a concept you already named.",
  ].join(" "),
  "concise-responses": [
    "Give the answer first.",
    "Do not repeat the question, narrate the process, or add an unsolicited recap.",
    "Expand only when the user asks for detail or the task requires it for safety.",
    "Offer deeper detail instead of including it, and name what you can expand on in one line.",
    "Before sending, delete each sentence that does not change what the user does or decides.",
  ].join(" "),
  "honest-claims": [
    "Open the reply with any correction to earlier work.",
    "This includes a defect in work you delivered in this same session.",
    "Mark each factual claim as verified, inferred, or opinion.",
    "Call a claim verified only if you checked the source in this session.",
    "Name the file, command, or document that you checked.",
    "Do not mix an unchecked claim into a list of checked claims.",
    "State the cost of each recommendation.",
    "Never defer a correction or a safety-relevant cost, even when you offer other detail instead.",
    "Before sending, check each factual sentence; label it or delete it if you did not verify it.",
  ].join(" "),
} satisfies Readonly<Record<SessionGuidanceId, string>>;

export interface PersistedSessionGuidance {
  readonly version: 1;
  readonly activeIds: string[];
}

export function persistedSessionGuidance(activeIds: readonly string[]): PersistedSessionGuidance {
  return { version: SESSION_GUIDANCE_VERSION, activeIds: normalizeSessionGuidanceIds(activeIds) };
}

export function restoreSessionGuidance(entries: readonly unknown[]): string[] {
  let latest: unknown;
  let found = false;
  for (const entry of entries) {
    if (!isGuidanceEntry(entry)) continue;
    latest = entry.data;
    found = true;
  }
  // No stored choice at all means the session predates the picker or has
  // never opened it, so every guidance starts on. A stored snapshot is
  // honoured as written, including an empty list, so an explicit clear is
  // not silently undone. A malformed snapshot stays empty rather than
  // turning guidance back on behind the user's back.
  if (!found) return [...DEFAULT_SESSION_GUIDANCE_IDS];
  if (!isRecord(latest) || latest["version"] !== SESSION_GUIDANCE_VERSION || !Array.isArray(latest["activeIds"])) return [];
  return normalizeSessionGuidanceIds(latest["activeIds"]);
}

export function sessionGuidancePromptBlock(activeIds: readonly string[]): string | undefined {
  const activeInstructions = normalizeSessionGuidanceIds(activeIds).flatMap((id) => isSessionGuidanceId(id) ? [instructions[id]] : []);
  if (activeInstructions.length === 0) return undefined;
  return `Session guidance:\n${activeInstructions.map((instruction) => `- ${instruction}`).join("\n")}`;
}

function isGuidanceEntry(value: unknown): value is { type: "custom"; customType: string; data?: unknown } {
  return isRecord(value) && value["type"] === "custom" && value["customType"] === SESSION_GUIDANCE_CUSTOM_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
