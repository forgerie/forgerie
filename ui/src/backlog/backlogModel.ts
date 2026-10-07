// What the backlog shows, decided once. Pure: the views and the launch read
// these functions and do no arithmetic of their own.
import { MARKDOWN, providerOf, type BacklogClaim, type BacklogItem, type BacklogList, type BacklogRef, type BacklogWarning } from "./backlogApi";

/** The list as the app last read it. A failed read keeps the last list it had. */
export type BacklogLoad = { type: "loading" } | { type: "failed"; message: string; last?: BacklogList | undefined } | { type: "ready"; value: BacklogList };
export const listOf = (load: BacklogLoad): BacklogList | undefined => load.type === "ready" ? load.value : load.type === "failed" ? load.last : undefined;

/**
 * One item, as the URL names it: `?backlog=<projectId>/<itemId>` for a markdown item,
 * `?backlog=github~<projectId>/<itemId>` for another provider's. Project ids are UUIDs, so `~` cannot
 * be part of one, and every link written before providers still reads as the markdown item it named.
 */
export type ItemRef = BacklogRef;
/** Where the backlog is open: the list, or one item. */
export interface BacklogPlace { item?: ItemRef | undefined }

export const refOf = (item: Pick<BacklogItem, "projectId" | "id" | "provider">): ItemRef => ({ projectId: item.projectId, itemId: item.id, provider: item.provider });
export const itemParam = (ref: ItemRef) => `${providerOf(ref) === MARKDOWN ? "" : `${providerOf(ref)}~`}${ref.projectId}/${ref.itemId}`;
export function readItemParam(value: string | null | undefined): ItemRef | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  const head = value.slice(0, Math.max(slash, 0));
  const itemId = value.slice(slash + 1);
  const tilde = head.indexOf("~");
  const provider = tilde > 0 ? head.slice(0, tilde) : MARKDOWN;
  const projectId = tilde > 0 ? head.slice(tilde + 1) : head;
  return slash > 0 && projectId && itemId ? { projectId, itemId, provider } : undefined;
}
/** `?backlog` alone is the list; `?backlog=<projectId>/<itemId>` is one item. Absent: the backlog is not open. */
export function readBacklogPlace(params: URLSearchParams): BacklogPlace | undefined {
  if (!params.has("backlog")) return undefined;
  const item = readItemParam(params.get("backlog"));
  return item ? { item } : {};
}
export const sameItem = (a: ItemRef | undefined, b: ItemRef | undefined) => a !== undefined && b !== undefined
  && a.projectId === b.projectId && a.itemId === b.itemId && providerOf(a) === providerOf(b);
/** The list's item for a reference. */
export const findItem = (items: readonly BacklogItem[] | undefined, ref: ItemRef) => items?.find((item) => sameItem(refOf(item), ref));
/** A GitHub issue reads as its number; a file's id is too long and too private to show. */
export const isGitHub = (item: Pick<BacklogItem, "provider">) => item.provider === "github";
export const issueNumber = (item: Pick<BacklogItem, "provider" | "id">) => isGitHub(item) ? `#${item.id}` : undefined;

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
  const hay = [item.title, item.id, issueNumber(item) ?? "", item.provider, item.projectName, ...item.labels].join("\n").toLowerCase();
  return words.every((word) => hay.includes(word));
}

export interface BacklogGroup {
  key: string;
  label: string;
  /** `held` collects items a session holds, from every project. */
  kind: "held" | "project";
  items: BacklogItem[];
  projectId?: string | undefined;
  /** The project's backlog folder is ignored by Git (brief A2). */
  ignored?: BacklogWarning | undefined;
  /** What a provider says about this project's list: issues it hid, a cut-short list, a list that is not current. */
  notes?: BacklogWarning[] | undefined;
}
/** Provider notes that belong beside a project's items. A login problem is not one: it has its own place, above the list. */
const isGroupNote = (warning: BacklogWarning) => warning.provider !== undefined && warning.provider !== MARKDOWN
  && (warning.kind === "items-hidden" || warning.kind === "provider-unavailable" || warning.kind === "scan-limit");
/** GitHub needs a login before it can list a project's issues. */
export const authWarnings = (warnings: readonly BacklogWarning[]) => warnings.filter((warning) => warning.kind === "provider-auth");
/**
 * Held items first, from every project, because they have a session to go to.
 * Then one group per project, by name. In a group: priority, then newest.
 * Done items show only on request, after the open ones.
 */
export function groupBacklog(items: readonly BacklogItem[], warnings: readonly BacklogWarning[], options: { filter?: string; showDone?: boolean } = {}): BacklogGroup[] {
  const shown = items.filter((item) => (options.showDone || item.readiness !== "closed") && matches(item, options.filter ?? ""));
  const order = (a: BacklogItem, b: BacklogItem) => Number(a.readiness === "closed") - Number(b.readiness === "closed")
    || rank(a.priority) - rank(b.priority) || (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title);
  const held = shown.filter((item) => item.claim !== undefined).sort((a, b) => (b.claim?.claimedAt ?? "").localeCompare(a.claim?.claimedAt ?? ""));
  const projects = new Map<string, BacklogItem[]>();
  for (const item of shown) if (item.claim === undefined) projects.set(item.projectId, [...projects.get(item.projectId) ?? [], item]);
  const ignored = new Map(warnings.filter((warning) => warning.kind === "ignored-directory").map((warning) => [warning.projectId, warning]));
  const notes = (projectId: string) => warnings.filter((warning) => warning.projectId === projectId && isGroupNote(warning));
  const groups: BacklogGroup[] = [...projects].map(([projectId, list]) => ({ key: `project:${projectId}`, label: list[0]!.projectName, kind: "project" as const,
    projectId, items: list.sort(order), ...(ignored.has(projectId) ? { ignored: ignored.get(projectId) } : {}),
    ...(notes(projectId).length ? { notes: notes(projectId) } : {}) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return held.length ? [{ key: "held", label: "In a session", kind: "held", items: held }, ...groups] : groups;
}

/** The items the footer counts: open, not done. */
export const openCount = (items: readonly BacklogItem[]) => items.filter((item) => item.open && item.readiness !== "closed").length;
export const projectCount = (items: readonly BacklogItem[]) => new Set(items.map((item) => item.projectId)).size;
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
  return warnings.filter((warning) => !placed.has(warning) && warning.kind !== "ignored-directory" && warning.kind !== "provider-auth");
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

/** A project-relative path, for a person: the file under its repository. A GitHub issue's path is already `owner/name#42`. */
export function relativePath(item: Pick<BacklogItem, "path" | "repo">): string {
  return item.path.startsWith(`${item.repo}/`) ? item.path.slice(item.repo.length + 1) : item.path;
}
