import { normalizeSessionGuidanceIds } from "../../shared/sessionGuidance.js";

export const SESSION_GUIDANCE_CUSTOM_TYPE = "forgerie.session-guidance";
const SESSION_GUIDANCE_VERSION = 1;

const instructions: Readonly<Record<string, string>> = {
  "technical-english": "Use ASD-STE100 Simplified Technical English. Use short sentences. Put one idea in each sentence. Use plain words and one term for each concept.",
};

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
  if (!found || !isRecord(latest) || latest["version"] !== SESSION_GUIDANCE_VERSION || !Array.isArray(latest["activeIds"])) return [];
  return normalizeSessionGuidanceIds(latest["activeIds"]);
}

export function sessionGuidancePromptBlock(activeIds: readonly string[]): string | undefined {
  const activeInstructions = normalizeSessionGuidanceIds(activeIds).flatMap((id) => {
    const instruction = instructions[id];
    return instruction === undefined ? [] : [instruction];
  });
  if (activeInstructions.length === 0) return undefined;
  return `Session guidance:\n${activeInstructions.map((instruction) => `- ${instruction}`).join("\n")}`;
}

function isGuidanceEntry(value: unknown): value is { type: "custom"; customType: string; data?: unknown } {
  return isRecord(value) && value["type"] === "custom" && value["customType"] === SESSION_GUIDANCE_CUSTOM_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
