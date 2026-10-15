// What the triggers screen remembers while it is closed: unsaved drafts and the Run now requests whose runs the
// history does not show yet. The app's binding makes one for the app's life and hands it to the screen, so Back, a
// fold, or a visit to a session keeps a draft. A test or a preview makes its own, so nothing leaks between them.
import type { TriggerDraft } from "./triggerDraft";
import type { ScheduleDraft } from "./triggerFile";
import type { PendingRun } from "./triggerWords";
import type { TriggerPlace } from "./triggersModel";

/**
 * A draft, the saved settings it started from, and the revision it read them at. `refused` is set when the server
 * refused a save because another change came first.
 */
export interface StoredDraft { draft: TriggerDraft; start: TriggerDraft; revision: number; refused: boolean }

/**
 * A workflow file's unsaved edits: the editor's text and the side panel, with the file's hash and the panel's values
 * and the original text when the edit began. A save sends that hash, so a file changed elsewhere in the meantime is refused, not overwritten.
 */
export interface StoredFileDraft { text: string; startText: string; baseSha256: string; settings: ScheduleDraft; start: ScheduleDraft }

export interface TriggerMemory {
  /** By `draftKey`. */
  drafts: Map<string, StoredDraft>;
  /** By trigger ID. */
  files: Map<string, StoredFileDraft>;
  /** By trigger ID. */
  pendingRuns: Map<string, PendingRun>;
}

export function createTriggerMemory(): TriggerMemory {
  return { drafts: new Map(), files: new Map(), pendingRuns: new Map() };
}

/** "create" for the new trigger, "trigger:<id>" for a saved one, so a trigger whose ID is "create" has its own. */
export function draftKey(place: Exclude<TriggerPlace, { view: "list" }>): string {
  return place.view === "create" ? "create" : `trigger:${place.id}`;
}
