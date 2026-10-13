// What the backlog shows, decided once. Pure: the views and the launch read
// these functions and do no arithmetic of their own.
import { AZURE_DEVOPS, MARKDOWN, providerOf, type BacklogClaim, type BacklogItem, type BacklogList, type BacklogOwner, type BacklogRef, type BacklogSourceSummary, type BacklogWarning,
  type Destination } from "./backlogApi";

/** The list as the app last read it. A failed read keeps the last list it had. */
export type BacklogLoad = { type: "loading" } | { type: "failed"; message: string; last?: BacklogList | undefined } | { type: "ready"; value: BacklogList };
export const listOf = (load: BacklogLoad): BacklogList | undefined => load.type === "ready" ? load.value : load.type === "failed" ? load.last : undefined;

/**
 * One item, as the URL names it: `?backlog=<projectId>/<itemId>` for a markdown item,
 * `?backlog=github~<projectId>/<itemId>` for another provider's, and `?backlog=source:<sourceId>/<itemId>`
 * for a source's item. Project ids are UUIDs, so neither `~` nor `source:` can be part of one, and every
 * link written before providers still reads as the markdown item it named.
 */
export type ItemRef = BacklogRef;
/** Where the backlog is open: the list, or one item. */
export interface BacklogPlace { item?: ItemRef | undefined }

const SOURCE = "source:";
export const refOf = (item: Pick<BacklogItem, "owner" | "id" | "provider">): ItemRef => item.owner.kind === "source"
  ? { sourceId: item.owner.sourceId, itemId: item.id, provider: item.provider }
  : { projectId: item.owner.projectId, itemId: item.id, provider: item.provider };
export const itemParam = (ref: ItemRef) => ref.sourceId !== undefined ? `${SOURCE}${ref.sourceId}/${ref.itemId}`
  : `${providerOf(ref) === MARKDOWN ? "" : `${providerOf(ref)}~`}${ref.projectId}/${ref.itemId}`;
export function readItemParam(value: string | null | undefined): ItemRef | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  const head = value.slice(0, Math.max(slash, 0));
  const itemId = value.slice(slash + 1);
  if (slash <= 0 || !itemId) return undefined;
  if (head.startsWith(SOURCE)) {
    const sourceId = head.slice(SOURCE.length);
    return sourceId ? { sourceId, itemId, provider: AZURE_DEVOPS } : undefined;
  }
  const tilde = head.indexOf("~");
  const provider = tilde > 0 ? head.slice(0, tilde) : MARKDOWN;
  const projectId = tilde > 0 ? head.slice(tilde + 1) : head;
  return projectId ? { projectId, itemId, provider } : undefined;
}
/** `?backlog` alone is the list; `?backlog=<projectId>/<itemId>` is one item. Absent: the backlog is not open. */
export function readBacklogPlace(params: URLSearchParams): BacklogPlace | undefined {
  if (!params.has("backlog")) return undefined;
  const item = readItemParam(params.get("backlog"));
  return item ? { item } : {};
}
/** A source lists Azure DevOps items only, so a source's reference needs no provider. */
const refProvider = (ref: ItemRef) => ref.sourceId !== undefined ? ref.provider ?? AZURE_DEVOPS : providerOf(ref);
export const sameItem = (a: ItemRef | undefined, b: ItemRef | undefined) => a !== undefined && b !== undefined
  && a.projectId === b.projectId && a.sourceId === b.sourceId && a.itemId === b.itemId && refProvider(a) === refProvider(b);
/** The list's item for a reference. */
export const findItem = (items: readonly BacklogItem[] | undefined, ref: ItemRef) => items?.find((item) => sameItem(refOf(item), ref));
/** Another item from the same project or source, such as a blocker, by its id. */
export const siblingRef = (item: Pick<BacklogItem, "owner" | "provider">, itemId: string): ItemRef => refOf({ ...item, id: itemId });

/** The name a person knows an owner by: the project's name, or the source's label. */
export const ownerName = (owner: BacklogOwner) => owner.kind === "project" ? owner.projectName : owner.label;
/** One key per project or source, used for groups and counts. */
export const ownerKey = (owner: BacklogOwner) => owner.kind === "project" ? `project:${owner.projectId}` : `${SOURCE}${owner.sourceId}`;

/**
 * Where a session for this item starts by default: its destination project's folder. A project's own item falls back
 * to its repository. Undefined for a source's item that is not routed, or whose project is not registered here.
 */
export function launchFolder(item: Pick<BacklogItem, "destination" | "owner">, projects: readonly { id: string; path: string }[]): string | undefined {
  const { destination } = item;
  const routed = destination.kind === "routed" ? projects.find((project) => project.id === destination.projectId)?.path : undefined;
  return routed ?? (item.owner.kind === "project" ? item.owner.repo : undefined);
}
/** A destination as a group header says it: "→ amaze-next", or "Not routed". */
export function destinationWords(destination: Destination, projectName: (id: string) => string | undefined): string {
  return destination.kind === "routed" ? `→ ${projectName(destination.projectId) ?? "a registered project"}` : "Not routed";
}
/** Why a source is not routed, when the header's two words are not enough. */
export function destinationProblem(destination: Destination): string | undefined {
  return destination.kind === "not-routed" && destination.reason === "missing-project"
    ? "This source's destination project is no longer registered. Choose another in Settings → Backlog, or pick a project when you start a session." : undefined;
}
/** A destination as an item page says it, in full. */
export function destinationDetail(destination: Destination, projectName: (id: string) => string | undefined): string {
  if (destination.kind === "routed") return projectName(destination.projectId) ?? "A registered project";
  return destinationProblem(destination) ?? "Not routed. You choose a project when you start a session, or set one in Settings → Backlog.";
}
/**
 * The new-session window's line about where a source's item starts. `chosen` is the project the window
 * points at now, if any; `routed` says whether that is the source's own destination.
 */
export function carryRoute(item: Pick<BacklogItem, "owner">, chosen: string | undefined, routed: boolean): { text: string; attention: boolean } | undefined {
  if (item.owner.kind !== "source") return undefined;
  if (chosen === undefined) return { text: "This source has no destination. Choose a project, or set one in Settings → Backlog.", attention: true };
  return { text: `Starts in ${chosen} · ${routed ? "source destination" : "chosen here"}`, attention: false };
}

/** Keep provider words and display numbers together; Azure IDs include the organization for claim identity. */
export function remoteSource(item: Pick<BacklogItem, "provider" | "id">) {
  if (item.provider === "github") return { name: "GitHub", noun: "issue", number: `#${item.id}` };
  if (item.provider === "azure-devops") return { name: "Azure DevOps", noun: "work item", number: `#${item.id.slice(item.id.lastIndexOf(":") + 1)}` };
  return undefined;
}
export const issueNumber = (item: Pick<BacklogItem, "provider" | "id">) => remoteSource(item)?.number;

const DAY = 86_400_000;
/** Whole days since `created`, or undefined when the file gives no readable date. */
function days(created: string | undefined, now: number): number | undefined {
  if (!created) return undefined;
  const at = Date.parse(created);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY)) : undefined;
}
/** The row's shorthand age: "21d", "today". Empty when the file has no date. */
export function ageText(created: string | undefined, now: number): string {
  const n = days(created, now);
  return n === undefined ? "" : n === 0 ? "today" : `${String(n)}d`;
}
/** The item page's age: "21 days ago". */
export function ageWords(created: string | undefined, now: number): string | undefined {
  const n = days(created, now);
  return n === undefined ? undefined : n === 0 ? "Today" : n === 1 ? "Yesterday" : `${String(n)} days ago`;
}

/** Priority is a word: "High". A file without one shows none. */
export function priorityWord(priority: string | undefined): string | undefined {
  const value = priority?.trim();
  return value ? value[0]!.toUpperCase() + value.slice(1) : undefined;
}
const RANK: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };
const rank = (priority: string | undefined) => RANK[priority?.trim().toLowerCase() ?? ""] ?? 4;

/** What a held item's session is doing, in the session list's own words. */
export type HolderState = "working" | "blocked" | "open" | "starting" | "interrupted" | "missing";
export interface Holder { state: HolderState; name?: string | undefined; time?: string | undefined; sessionId?: string | undefined }
/** The session list's view of one session: its state, name, and shorthand time. */
export interface SessionLook { state: string; name?: string | undefined; time: string }
/** The claim is the truth (brief A5); the session list says what that session is doing now. */
export function holderOf(claim: BacklogClaim, look: (sessionId: string) => SessionLook | undefined): Holder {
  if (claim.kind === "launching") return { state: "starting" };
  if (claim.kind === "interrupted") return { state: "interrupted" };
  const row = look(claim.sessionId);
  if (!row) return { state: "missing", sessionId: claim.sessionId };
  const state = row.state === "working" ? "working" : row.state === "blocked" || row.state === "errored" ? "blocked" : "open";
  return { state, name: row.name, time: row.time, sessionId: claim.sessionId };
}
/** The words before the session's name: "Working in Atomic deploys". */
export const HOLDER_WORDS: Record<HolderState, string> = {
  working: "Working in", blocked: "Waiting for you in", open: "Open in",
  starting: "A session is starting", interrupted: "A launch did not finish", missing: "Held by a session that is not in the list",
};

export function matches(item: BacklogItem, filter: string): boolean {
  const words = filter.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [item.title, item.id, issueNumber(item) ?? "", item.provider, ownerName(item.owner), ...item.labels].join("\n").toLowerCase();
  return words.every((word) => hay.includes(word));
}

export interface BacklogGroup {
  key: string;
  label: string;
  /** `held` collects items a session holds, from every project and source. */
  kind: "held" | "project" | "source";
  items: BacklogItem[];
  projectId?: string | undefined;
  /** A source group's board and destination, when the list names the source. */
  source?: BacklogSourceSummary | undefined;
  /** The project's backlog folder is ignored by Git (brief A2). */
  ignored?: BacklogWarning | undefined;
  /** What a provider says about this group's list: issues it hid, a cut-short list, a list that is not current, a board another source also reads. */
  notes?: BacklogWarning[] | undefined;
}
const GROUP_NOTES = new Set(["items-hidden", "provider-unavailable", "scan-limit", "source-overlap", "retired-repo-azure"]);
/** Notes that belong beside a group's items. Setup and install problems are not: they have their own place, above the list. */
const isGroupNote = (warning: BacklogWarning) => GROUP_NOTES.has(warning.kind)
  && (warning.sourceId !== undefined || warning.kind === "retired-repo-azure" || warning.provider !== undefined && warning.provider !== MARKDOWN);
const isAccessWarning = (warning: BacklogWarning) => warning.provider === "github" && (warning.kind === "provider-auth" || warning.kind === "provider-install");
/** What stops GitHub listing a project's issues: GitHub is not set up here, or its app is not installed on the repo. */
export const accessWarnings = (warnings: readonly BacklogWarning[]) => warnings.filter(isAccessWarning);
/**
 * Held items first, from every project and source, because they have a session to go to.
 * Then one group per project and one per source, by name. In a group: priority, then newest.
 * Done items show only on request, after the open ones.
 */
export function groupBacklog(items: readonly BacklogItem[], warnings: readonly BacklogWarning[],
  options: { filter?: string; showDone?: boolean; sources?: readonly BacklogSourceSummary[] | undefined } = {}): BacklogGroup[] {
  const shown = items.filter((item) => (options.showDone || item.readiness !== "closed") && matches(item, options.filter ?? ""));
  const order = (a: BacklogItem, b: BacklogItem) => Number(a.readiness === "closed") - Number(b.readiness === "closed")
    || rank(a.priority) - rank(b.priority) || (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title);
  const held = shown.filter((item) => item.claim !== undefined).sort((a, b) => (b.claim?.claimedAt ?? "").localeCompare(a.claim?.claimedAt ?? ""));
  const owners = new Map<string, BacklogItem[]>();
  for (const item of shown) if (item.claim === undefined) owners.set(ownerKey(item.owner), [...owners.get(ownerKey(item.owner)) ?? [], item]);
  const ignored = new Map(warnings.filter((warning) => warning.kind === "ignored-directory").map((warning) => [warning.projectId, warning]));
  const notesOf = (owner: BacklogOwner) => warnings.filter((warning) => isGroupNote(warning)
    && (owner.kind === "project" ? warning.projectId === owner.projectId && warning.sourceId === undefined : warning.sourceId === owner.sourceId));
  const groups: BacklogGroup[] = [...owners].map(([key, list]): BacklogGroup => {
    const { owner } = list[0]!;
    const notes = notesOf(owner);
    const base = { key, items: list.sort(order), ...(notes.length ? { notes } : {}) };
    if (owner.kind === "source") {
      const source = options.sources?.find((entry) => entry.sourceId === owner.sourceId);
      return { ...base, kind: "source", label: source?.label ?? owner.label, ...(source ? { source } : {}) };
    }
    return { ...base, kind: "project", label: owner.projectName, projectId: owner.projectId, ...(ignored.has(owner.projectId) ? { ignored: ignored.get(owner.projectId) } : {}) };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return held.length ? [{ key: "held", label: "In a session", kind: "held", items: held }, ...groups] : groups;
}

/**
 * What a contested item says on its row: every session that holds it, by name where the session list knows it.
 * Undefined for an item with one claim.
 */
export function contestedLine(item: Pick<BacklogItem, "contested">, look: (sessionId: string) => SessionLook | undefined): string | undefined {
  if (!item.contested) return undefined;
  const names = item.contested.claims.map((claim) => claim.kind === "claimed" ? look(claim.sessionId)?.name ?? "a session not in the list" : claim.kind === "launching" ? "a starting session" : "an interrupted launch");
  return `Held by ${String(names.length)} sessions: ${names.join(", ")}. Archive or release them until one holds it.`;
}

/** The items the footer counts: open, not done. */
export const openCount = (items: readonly BacklogItem[]) => items.filter((item) => item.open && item.readiness !== "closed").length;
/** "in 2 projects", "in 1 project and 1 source": where the counted items come from. */
export function ownersText(items: readonly BacklogItem[]): string {
  const keys = new Set(items.map((item) => ownerKey(item.owner)));
  const sources = [...keys].filter((key) => key.startsWith(SOURCE)).length;
  const projects = keys.size - sources;
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
  return `in ${[projects || !sources ? plural(projects, "project") : "", sources ? plural(sources, "source") : ""].filter(Boolean).join(" and ")}`;
}
/** Sessions that hold an item, so the session list can mark them. */
export function heldSessions(items: readonly BacklogItem[]): ReadonlySet<string> {
  return new Set(items.flatMap((item) => item.claim?.kind === "claimed" ? [item.claim.sessionId] : []));
}

/**
 * Warnings that are not about a project group the list shows: files that are
 * not items, projects that could not be read, and ignored folders of projects
 * with no items. Ignored folders of shown projects sit in their group instead.
 */
export function otherWarnings(groups: readonly BacklogGroup[], warnings: readonly BacklogWarning[]): BacklogWarning[] {
  const placed = new Set(groups.flatMap((group) => [...group.ignored ? [group.ignored] : [], ...group.notes ?? []]));
  // A contested item says so on its own row, which always shows: it is held.
  const contested = new Set(groups.flatMap((group) => group.items.flatMap((item) => item.contested ? [item.path] : [])));
  return warnings.filter((warning) => !placed.has(warning) && warning.kind !== "ignored-directory" && !isAccessWarning(warning)
    && !(warning.kind === "contested-claim" && contested.has(warning.path)));
}

/**
 * The `.gitignore` lines that keep a default backlog folder in Git while the
 * rest of `.forgerie/` stays ignored. Undefined for an overridden folder: its
 * fix depends on the rule that matched, and the warning's own text says so.
 */
export function ignoredFix(warning: BacklogWarning): string | undefined {
  return /(?:^|\/)\.forgerie\/backlog\/?$/u.test(warning.path) ? ".forgerie/*\n!.forgerie/backlog/" : undefined;
}

/**
 * The first message of a session started from an item. The server's prompt
 * (the item id and the whole file) goes first. The author's words follow, or,
 * for a skill or prompt template, lead, because the command must open the
 * message and the item then rides as its arguments.
 */
export function firstMessage(initialPrompt: string, typed: string, command: boolean): string {
  const words = typed.trim();
  if (!words) return initialPrompt;
  return command ? `${words}\n\n${initialPrompt}` : `${initialPrompt}\n\n${words}`;
}

/**
 * The item's body as the page shows it, under its own title heading. A file
 * that opens with a `# Title` equal to that title loses that one line, so the
 * page does not say it twice. Anything else stays as written.
 */
export function bodyUnderTitle(body: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/u.exec(body);
  return match && match[1]!.trim() === title.trim() ? body.slice(match[0].length).replace(/^\s*\n/u, "") : body;
}

/** A project-relative path, for a person: the file under its repository. A GitHub issue's path is already `owner/name#42`; a source's item has no repository. */
export function relativePath(item: Pick<BacklogItem, "path" | "owner">): string {
  const repo = item.owner.kind === "project" ? item.owner.repo : undefined;
  return repo !== undefined && item.path.startsWith(`${repo}/`) ? item.path.slice(repo.length + 1) : item.path;
}
