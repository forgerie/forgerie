import type { CompactionState } from "./compaction";

/**
 * How the one composer reads a draft. A leading `!` runs a shell command in
 * the session; `!!` keeps its output out of the model's context. `!@` stays
 * the all-file mention trigger. The server strips the prefix itself, so a
 * shell draft carries the trimmed text it will receive.
 */
export type ShellDraft = { type: "chat" }
  | { type: "empty"; excludeFromContext: boolean }
  | { type: "shell"; text: string; excludeFromContext: boolean };

export function shellDraftOf(draft: string): ShellDraft {
  const text = draft.trimStart();
  if (!text.startsWith("!") || text.startsWith("!@")) return { type: "chat" };
  const excludeFromContext = text.startsWith("!!");
  const command = text.slice(excludeFromContext ? 2 : 1).trim();
  return command ? { type: "shell", text, excludeFromContext } : { type: "empty", excludeFromContext };
}

export type ShellAvailability = { type: "ready" } | { type: "blocked"; reason: string };
/** Mirrors the server's rejections. The server stays authoritative. */
export function shellAvailability({ connected, sending, bashRunning, compaction }: {
  connected: boolean; sending: boolean; bashRunning: boolean; compaction: CompactionState;
}): ShellAvailability {
  if (!connected) return { type: "blocked", reason: "Reconnect to run shell commands." };
  if (sending) return { type: "blocked", reason: "Wait for the current request to finish." };
  if (bashRunning) return { type: "blocked", reason: "Wait for the running shell command to finish." };
  if (compaction.type === "checking" || compaction.type === "queued" || compaction.type === "running") {
    return { type: "blocked", reason: "Shell commands wait until compaction finishes." };
  }
  return { type: "ready" };
}
