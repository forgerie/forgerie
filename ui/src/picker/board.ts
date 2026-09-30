// Pure picker model: sessions in, grouped rows out. No I/O, no clock of its own.
// Classification and grouping are ported from the Lit client's sessionBoard.ts
// and inboxLocation.ts (main, a348db81) so both clients agree on what a
// session "is". Review rules on top: rows carry no chat text and no status
// words; time is always shorthand.

export interface PickerSession {
  id: string;
  cwd: string;
  name?: string | undefined;
  modified: string;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  agentSpawned?: boolean | undefined;
}
export interface PickerStatus {
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  workingAgents?: number | undefined;
  runningProcesses?: number | undefined;
  blocked?: boolean | undefined;
}
export interface PickerActivity {
  phase: "active" | "idle" | "error";
  activeSince?: string | undefined;
}
export interface PickerProject { id: string; name: string; path: string }
export interface PickerWorkspace { projectId: string; path: string; label: string; isMain: boolean }

export type RowState = "blocked" | "errored" | "working" | "unread" | "open" | "archived";
export type GroupKind = "pinned" | Exclude<RowState, "open"> | "open";
export type AgeBand = "hour" | "today" | "yesterday" | "week" | "month" | "older";

export const GROUPS: readonly { kind: GroupKind; label: string }[] = [
  { kind: "pinned", label: "Pinned" },
  { kind: "blocked", label: "Blocked on you" },
  { kind: "errored", label: "Errored" },
  { kind: "working", label: "Working" },
  { kind: "unread", label: "Unread" },
  { kind: "open", label: "Open" },
  { kind: "archived", label: "Archived" },
];
export const AGE_BANDS: readonly { kind: AgeBand; label: string; collapsed: boolean }[] = [
  { kind: "hour", label: "Last hour", collapsed: false },
  { kind: "today", label: "Earlier today", collapsed: false },
  { kind: "yesterday", label: "Yesterday", collapsed: false },
  { kind: "week", label: "Earlier this week", collapsed: true },
  { kind: "month", label: "This month", collapsed: true },
  { kind: "older", label: "Older", collapsed: true },
];
export const DEFAULT_COLLAPSED: ReadonlySet<string> = new Set(AGE_BANDS.filter((band) => band.collapsed).map((band) => band.kind));

export interface Location {
  /** Stable key for project grouping. An unregistered cwd keys by itself. */
  projectKey: string;
  project: string;
  /** Present only off the main checkout. */
  branch?: string;
}
export interface Row {
  session: PickerSession;
  state: RowState;
  group: GroupKind;
  location: Location;
  /** Shorthand: "<1m", "41m", "2h". While working, the length of the current run. */
  time: string;
  working: boolean;
  agents: number;
  processes: number;
}
export type Section =
  | { type: "label"; key: string; text: string }
  | { type: "group"; key: string; label: string; kind: GroupKind | "band" | "project"; rows: Row[] };
export type Grouping = "state" | "project";

/**
 * One state per session. Precedence: archived > blocked > errored > working >
 * unread > open. Archived wins so a stale runtime cannot park an archived
 * session in Working.
 */
export function rowState(session: PickerSession, status: PickerStatus | undefined, activity: PickerActivity | undefined, unread: boolean): RowState {
  if (session.archived === true) return "archived";
  if (status?.blocked === true) return "blocked";
  if (activity?.phase === "error") return "errored";
  if (status?.isStreaming === true || status?.isCompacting === true || status?.isBashRunning === true || activity?.phase === "active") return "working";
  return unread ? "unread" : "open";
}

const HOUR = 3_600_000;
export function shortAge(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "<1m";
  if (s < 3600) return `${String(Math.floor(s / 60))}m`;
  if (s < 86_400) return `${String(Math.floor(s / 3600))}h`;
  if (s < 604_800) return `${String(Math.floor(s / 86_400))}d`;
  return `${String(Math.floor(s / 604_800))}w`;
}

/** Local calendar days: at 09:00, "yesterday" means the previous local date. */
export function ageBand(iso: string, now: number): AgeBand {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "older";
  if (at >= now - HOUR) return "hour";
  const midnight = (daysBack: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysBack); return d.getTime(); };
  if (at >= midnight(0)) return "today";
  if (at >= midnight(1)) return "yesterday";
  if (at >= midnight(7)) return "week";
  if (at >= midnight(30)) return "month";
  return "older";
}

const trim = (path: string) => path.replace(/[/\\]+$/u, "");
const lastSegment = (path: string) => path.split(/[/\\]/u).filter(Boolean).at(-1) ?? path;

/** Known workspaces win; otherwise the deepest project that contains the cwd names it. */
export function createLocationResolver(projects: readonly PickerProject[], workspaces: readonly PickerWorkspace[]) {
  const byPath = new Map<string, Location>();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const workspace of workspaces) {
    const project = projectById.get(workspace.projectId);
    if (!project) continue;
    byPath.set(trim(workspace.path), { projectKey: project.id, project: project.name, ...(workspace.isMain ? {} : { branch: workspace.label }) });
  }
  const deepestFirst = [...projects].sort((a, b) => trim(b.path).length - trim(a.path).length);
  return (cwd: string): Location => {
    const path = trim(cwd);
    const known = byPath.get(path);
    if (known) return known;
    for (const project of deepestFirst) {
      const root = trim(project.path);
      if (path === root) return { projectKey: project.id, project: project.name };
      if (path.startsWith(root) && /[/\\]/u.test(path.charAt(root.length))) return { projectKey: project.id, project: project.name, branch: lastSegment(path) };
    }
    return { projectKey: path, project: lastSegment(path) };
  };
}

export interface BoardInput {
  sessions: readonly PickerSession[];
  statuses: Readonly<Record<string, PickerStatus>>;
  activities: Readonly<Record<string, PickerActivity>>;
  unread: ReadonlySet<string>;
  locate: (cwd: string) => Location;
  now: number;
}

/** Top-level rows. Agent-spawned sessions belong to their parent, not the picker. */
export function rows(input: BoardInput): Row[] {
  return input.sessions.filter((session) => session.agentSpawned !== true).map((session) => {
    const status = input.statuses[session.id];
    const activity = input.activities[session.id];
    const state = rowState(session, status, activity, input.unread.has(session.id));
    const group: GroupKind = state === "archived" ? "archived" : session.pinned === true ? "pinned" : state;
    const working = state === "working";
    const since = working ? activity?.activeSince ?? session.modified : session.modified;
    return {
      session, state, group, working,
      location: input.locate(session.cwd),
      time: shortAge(since, input.now),
      agents: status?.workingAgents ?? 0,
      processes: status?.runningProcesses ?? 0,
    };
  });
}

const byPinnedThenRecency = (a: Row, b: Row) =>
  Number(b.session.pinned === true) - Number(a.session.pinned === true)
  || Date.parse(b.session.modified) - Date.parse(a.session.modified);

/**
 * The list in drawn order. Empty groups are omitted. In state mode the Open
 * group is replaced by its age bands under one label. Archived appears only
 * when asked for.
 */
export function sections(all: readonly Row[], options: { grouping: Grouping; showArchived: boolean; now: number }): Section[] {
  const visible = options.showArchived ? [...all] : all.filter((row) => row.state !== "archived");
  if (options.grouping === "project") {
    const byProject = new Map<string, Row[]>();
    for (const row of visible) byProject.set(row.location.projectKey, [...byProject.get(row.location.projectKey) ?? [], row]);
    return [...byProject.values()]
      .map((groupRows) => groupRows.sort(byPinnedThenRecency))
      .sort((a, b) => (a[0]?.location.project ?? "").localeCompare(b[0]?.location.project ?? ""))
      .map((groupRows) => ({ type: "group", key: `project:${groupRows[0]?.location.projectKey ?? ""}`, label: groupRows[0]?.location.project ?? "", kind: "project", rows: groupRows }));
  }
  const out: Section[] = [];
  for (const group of GROUPS) {
    const groupRows = visible.filter((row) => row.group === group.kind).sort(byPinnedThenRecency);
    if (groupRows.length === 0) continue;
    if (group.kind !== "open") { out.push({ type: "group", key: group.kind, label: group.label, kind: group.kind, rows: groupRows }); continue; }
    out.push({ type: "label", key: "open-label", text: `Open · ${String(groupRows.length)} · by age` });
    for (const band of AGE_BANDS) {
      const bandRows = groupRows.filter((row) => ageBand(row.session.modified, options.now) === band.kind);
      if (bandRows.length > 0) out.push({ type: "group", key: band.kind, label: band.label, kind: "band", rows: bandRows });
    }
  }
  return out;
}

/** Rows a keyboard walks: expanded groups only, in drawn order. */
export function navigable(list: readonly Section[], collapsed: ReadonlySet<string>): Row[] {
  return list.flatMap((section) => section.type === "group" && !collapsed.has(section.key) ? section.rows : []);
}

/** The one mark the closed picker can show. Blocked outranks unread. */
export function attention(all: readonly Row[]): "blocked" | "unread" | undefined {
  if (all.some((row) => row.state === "blocked")) return "blocked";
  if (all.some((row) => row.state === "unread")) return "unread";
  return undefined;
}
