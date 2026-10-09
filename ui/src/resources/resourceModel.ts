import type { OriginKind, ResourceEntry, ResourceErrorKind, ResourceKind, ResourceScope, SaveEffect } from "./resourceApi";

/** The kinds as the switch over the list names them. */
export const KIND_LABELS: Record<ResourceKind, string> = { skill: "Skills", prompt: "Prompts", context: "Context" };

/** Origins in the order Pi lets them win: a project's own files first, then yours, then what Forgerie and packages bring. */
const ORIGIN_ORDER: readonly OriginKind[] = ["project", "user", "bundled", "package"];
export const ORIGIN_LABELS: Record<OriginKind, string> = {
  project: "This project", user: "Yours", bundled: "Built into Forgerie", package: "From packages",
};

/** A file named with where it lives, for a sentence: `handoff (built into Forgerie)`. */
export const placed = (entry: ResourceEntry) => {
  const label = ORIGIN_LABELS[entry.origin.kind];
  return `${entry.name} (${label.charAt(0).toLowerCase()}${label.slice(1)})`;
};

export interface ResourceSection {
  origin: OriginKind;
  title: string;
  /** Where the files of this section live, for the note under it. */
  roots: string[];
  entries: ResourceEntry[];
}

const matches = (entry: ResourceEntry, query: string) => {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const haystack = `${entry.name} ${entry.description} ${entry.origin.source}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

/** How many files of each kind the list holds, for the switch's counts. */
export function kindCounts(entries: readonly ResourceEntry[]): Record<ResourceKind, number> {
  const counts: Record<ResourceKind, number> = { skill: 0, prompt: 0, context: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** The list for one kind, filtered by the query, in sections by origin. Empty sections are left out. */
export function sections(entries: readonly ResourceEntry[], kind: ResourceKind, query = ""): ResourceSection[] {
  const shown = entries.filter((entry) => entry.kind === kind && matches(entry, query));
  return ORIGIN_ORDER.flatMap((origin) => {
    const inOrigin = shown.filter((entry) => entry.origin.kind === origin)
      .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
    if (inOrigin.length === 0) return [];
    return [{ origin, title: ORIGIN_LABELS[origin], roots: [...new Set(inOrigin.map((entry) => entry.origin.root))], entries: inOrigin }];
  });
}

/** One flag on a list row. `error` and `draft` tones draw as the settings rows already do. */
export interface RowFlag { text: string; tone?: "error" | "draft" | undefined }

/** What a row says besides its name: why it is not in effect, how it runs, and whether it can change. */
export function rowFlags(entry: ResourceEntry, byId: ReadonlyMap<string, ResourceEntry>, unsaved: boolean): RowFlag[] {
  const flags: RowFlag[] = [];
  const { activation } = entry;
  if (activation.kind === "shadowed") {
    const winner = byId.get(activation.winnerId);
    flags.push({ text: winner ? `Hidden by ${placed(winner)}` : "Hidden by another file" });
  }
  if (activation.kind === "disabled") flags.push({ text: "Turned off" });
  if (activation.kind === "invalid") flags.push({ text: activation.message, tone: "error" });
  if (entry.manual) flags.push({ text: "Runs only when you ask" });
  if (entry.edit.kind === "read-only") flags.push({ text: "Read-only" });
  if (unsaved) flags.push({ text: "Unsaved changes", tone: "draft" });
  return flags;
}

/** True when the file is not the one Pi uses. */
export const inactive = (entry: ResourceEntry) => entry.activation.kind !== "active";

/** The other files that this one hides, by name. */
export function hides(entry: ResourceEntry, entries: readonly ResourceEntry[]): ResourceEntry[] {
  return entries.filter((other) => other.activation.kind === "shadowed" && other.activation.winnerId === entry.id);
}

/** The session's checkout, named by its folder, for the editor's subtitle. */
export const checkoutName = (cwd: string) => cwd.split("/").filter(Boolean).at(-1) ?? cwd;

/** What saving will do, said before the reader saves. Undefined for a read-only file. */
export function saveConsequence(entry: ResourceEntry, scope: ResourceScope | undefined): string | undefined {
  if (entry.edit.kind === "read-only") return undefined;
  const later = scope?.kind === "session" ? " This session reads it after /reload." : " Sessions read it when they start or reload.";
  switch (entry.edit.saveEffect) {
    case "commit": return `Saving commits this one file in the project's main checkout. Other changes stay out of the commit.${later}`;
    case "uncommitted": return `Saving leaves an uncommitted change in this checkout.${later}`;
    case "file-only": return `Saving writes the file.${later}`;
  }
}

/** What happened, said after a save. */
export function savedMessage(effect: SaveEffect): string {
  switch (effect.kind) {
    case "unchanged": return "Nothing changed, so nothing was saved.";
    case "file-only": return "Saved.";
    case "uncommitted": return "Saved. The change is not committed.";
    case "committed": return `Saved and committed as ${effect.sha.slice(0, 7)} on ${effect.branch}.`;
  }
}

/** The reader's next step after a refused save. The server's own words come first. */
export function refusalAdvice(kind: ResourceErrorKind, savedToDisk: boolean): string | undefined {
  if (kind === "conflict") return "Your edits are still here. Read the file again to see the new version; that drops your edits.";
  if (kind === "commit-failed") return "The file is saved, but the commit did not complete. Check the checkout's Git status before you save again.";
  if (kind === "unsafe-git-state") return "Nothing was written. Finish or undo the Git operation in that checkout, then save again.";
  if (kind === "not-found") return "The file is no longer in this list. Read the list again.";
  if (kind === "busy") return "Try again in a moment.";
  return savedToDisk ? "The file on disk changed. Read it again before you retry." : undefined;
}
