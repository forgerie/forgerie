/**
 * Pure derivation: a flat list of sessions → an inbox board grouped by what
 * each session needs from you.
 *
 * No I/O, no DOM, no global clock — `now` is passed in to `relativeTime`.
 * Inputs are structural subsets of the wire types so the real `SessionInfo`,
 * `SessionStatus`, and `SessionActivity` satisfy them without an import cycle.
 *
 * `BOARD_GROUPS` is the single source of truth for the case list. Every label,
 * order, count, and rendering loop reads from here — nothing keeps a second
 * hand-written copy.
 *
 * Graduated from `prototypes/session-board/sessionBoard.js`.
 */

// ---------------------------------------------------------------------------
// Structural input types (subsets of wire types)
// ---------------------------------------------------------------------------

/** Structural subset of PendingAskUser needed for board classification. */
export interface SessionBoardPendingAsk {
  readonly questions: readonly { readonly question: string }[];
}

/** Structural subset of PendingExtensionDialog needed for board classification. */
export interface SessionBoardPendingDialog {
  readonly title: string;
}

/** Structural subset of SessionStatus needed for board classification. */
export interface SessionBoardStatusInput {
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly isBashRunning: boolean;
  /** Delegated agents working now; drives the row's live-work indicator. */
  readonly workingAgents?: number | undefined;
  /** Managed processes running now; drives the row's live-work indicator. */
  readonly runningProcesses?: number | undefined;
  readonly pendingAsk?: SessionBoardPendingAsk | undefined;
  readonly pendingDialogs?: readonly SessionBoardPendingDialog[] | undefined;
}

/** Structural subset of SessionActivity needed for board classification. */
export interface SessionBoardActivityInput {
  readonly phase: "active" | "idle" | "error";
  readonly label: string;
}

/** Structural subset of SessionInfo needed for board classification. */
export interface SessionBoardSessionInput {
  readonly id: string;
  readonly modified: string;
  readonly archived?: boolean;
  readonly archivedAt?: string;
  /** Pinned sessions sort to the top of whichever group they land in. */
  readonly pinned?: boolean;
  /**
   * Working directory of the session (workspace path). Present on every
   * `SessionInfo`; included here so `locationOf` callbacks can look up
   * the workspace without additional type wrangling.
   */
  readonly cwd?: string;
  /**
   * True when an agent spawned this session to talk to another agent. The
   * board's top level is the conversations the user is in, so these are left
   * out of it; the session that owns them surfaces them in its own pane.
   */
  readonly agentSpawned?: boolean;
}

/** Location metadata for one session row, derived by the caller from their own data. */
export interface SessionBoardLocation {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
}

// ---------------------------------------------------------------------------
// Tagged union: session board state
// ---------------------------------------------------------------------------

export type BoardGroupKind = "blocked" | "errored" | "working" | "unread" | "open" | "archived";

export type SessionBoardState =
  | { readonly kind: "blocked"; readonly reason: "ask"; readonly question: string }
  | { readonly kind: "blocked"; readonly reason: "dialog"; readonly question: string }
  | { readonly kind: "errored"; readonly detail: string }
  | { readonly kind: "working"; readonly detail?: string }
  | { readonly kind: "unread"; readonly completedAt?: string }
  | { readonly kind: "open" }
  | { readonly kind: "archived"; readonly archivedAt?: string };

// ---------------------------------------------------------------------------
// BOARD_GROUPS — the single source of truth for case order and labels
// ---------------------------------------------------------------------------

export interface BoardGroupDescriptor {
  readonly kind: BoardGroupKind;
  readonly label: string;
  readonly hint: string;
  readonly tone: "warning" | "danger" | "success" | "accent" | "muted" | "dim";
}

/**
 * The set of states a session can be in, in triage order.
 *
 * This is the single source of truth for the case list. Labels, order,
 * counts, empty states, and the rendering loop all read from here — nothing
 * keeps a second hand-written copy.
 */
export const BOARD_GROUPS: readonly BoardGroupDescriptor[] = [
  {
    kind: "blocked",
    label: "Blocked on you",
    hint: "The agent asked a question and is waiting.",
    tone: "warning",
  },
  {
    kind: "errored",
    label: "Errored",
    hint: "The last turn ended in an error.",
    tone: "danger",
  },
  {
    kind: "working",
    label: "Working",
    hint: "The agent is running right now.",
    tone: "success",
  },
  {
    kind: "unread",
    label: "Unread",
    hint: "Finished while you were away. You have not looked yet.",
    tone: "accent",
  },
  {
    kind: "open",
    label: "Open",
    hint: "Read, idle, not archived. The pile you are still thinking about.",
    tone: "muted",
  },
  {
    kind: "archived",
    label: "Archived",
    hint: "Done. Kept for history.",
    tone: "dim",
  },
] as const;

const GROUP_KINDS: readonly BoardGroupKind[] = BOARD_GROUPS.map((g) => g.kind);

// ---------------------------------------------------------------------------
// AGE_BANDS — the single source of truth for the idle case list
// ---------------------------------------------------------------------------

export type AgeBandKind = "hour" | "today" | "yesterday" | "week" | "month" | "older";

export interface AgeBandDescriptor {
  readonly kind: AgeBandKind;
  readonly label: string;
  readonly hint: string;
  /** Bands past yesterday open collapsed; the pile they hold is the one nobody asked to see. */
  readonly collapsedByDefault: boolean;
  /**
   * Local midnights back from today that this band starts at, or `"hour"` for
   * the rolling window, or `undefined` for the band that catches everything
   * older. Read only by `ageBandKind`.
   */
  readonly daysBack: number | "hour" | undefined;
}

/**
 * How old an idle session is, in the words a reader would use.
 *
 * Boundaries are **local calendar days**, not elapsed hours: someone reading at
 * 09:00 means "yesterday", not "19 hours ago". The one consequence is that the
 * band a session sits in depends on the reading device's time zone, and a row
 * changes band at local midnight rather than 24 h after its last turn.
 *
 * This is the single source of truth for the case list. Labels, order, counts,
 * collapse defaults, and the rendering loop all read from here.
 */
export const AGE_BANDS: readonly AgeBandDescriptor[] = [
  {
    kind: "hour",
    label: "Last hour",
    hint: "Touched within the hour.",
    collapsedByDefault: false,
    daysBack: "hour",
  },
  {
    kind: "today",
    label: "Earlier today",
    hint: "Touched today, more than an hour ago.",
    collapsedByDefault: false,
    daysBack: 0,
  },
  {
    kind: "yesterday",
    label: "Yesterday",
    hint: "Touched on the previous local day.",
    collapsedByDefault: false,
    daysBack: 1,
  },
  {
    kind: "week",
    label: "Earlier this week",
    hint: "Two to seven days back.",
    collapsedByDefault: true,
    daysBack: 7,
  },
  {
    kind: "month",
    label: "This month",
    hint: "Eight to thirty days back.",
    collapsedByDefault: true,
    daysBack: 30,
  },
  {
    kind: "older",
    label: "Older",
    hint: "More than thirty days back.",
    collapsedByDefault: true,
    daysBack: undefined,
  },
] as const;

/** Band kinds that open collapsed the first time a machine's inbox is read. */
export const DEFAULT_COLLAPSED_AGE_BANDS: readonly AgeBandKind[] = AGE_BANDS
  .filter((band) => band.collapsedByDefault)
  .map((band) => band.kind);

const HOUR_MS = 60 * 60 * 1000;

/** Epoch ms of local midnight `daysBack` days before the local day containing `now`. */
function localMidnightBack(now: number, daysBack: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysBack);
  return date.getTime();
}

/**
 * Which band an ISO timestamp falls in, relative to `now`.
 *
 * A timestamp in the future — a session modified by a machine whose clock runs
 * ahead — lands in `hour` rather than falling through to `older`.
 */
export function ageBandKind(iso: string, now: number): AgeBandKind {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "older";
  for (const band of AGE_BANDS) {
    if (band.daysBack === undefined) return band.kind;
    const from = band.daysBack === "hour" ? now - HOUR_MS : localMidnightBack(now, band.daysBack);
    if (at >= from) return band.kind;
  }
  return "older";
}

// ---------------------------------------------------------------------------
// sessionBoardState — classify one session
// ---------------------------------------------------------------------------

export interface SessionBoardContext {
  readonly status?: SessionBoardStatusInput | undefined;
  readonly activity?: SessionBoardActivityInput | undefined;
  readonly isUnread?: boolean | undefined;
  readonly unreadCompletedAt?: string | undefined;
}

/**
 * Classify one session into exactly one state.
 *
 * Precedence is deliberate and total:
 *   archived > blocked > errored > working > unread > open
 *
 * `archived` wins outright so a stale runtime cannot park an archived session
 * back in "Working". Everything below it is ordered by how much it wants your
 * attention right now.
 */
export function sessionBoardState(
  session: SessionBoardSessionInput,
  context: SessionBoardContext,
): SessionBoardState {
  const { status, activity, isUnread = false, unreadCompletedAt } = context;

  if (session.archived === true) {
    return session.archivedAt !== undefined
      ? { kind: "archived", archivedAt: session.archivedAt }
      : { kind: "archived" };
  }

  if (status?.pendingAsk != null) {
    return {
      kind: "blocked",
      reason: "ask",
      question: status.pendingAsk.questions[0]?.question ?? "",
    };
  }

  const firstDialog = status?.pendingDialogs?.[0];
  if (firstDialog !== undefined) {
    return { kind: "blocked", reason: "dialog", question: firstDialog.title };
  }

  if (activity?.phase === "error") {
    return { kind: "errored", detail: activity.label };
  }

  if (status?.isCompacting === true) {
    return { kind: "working", detail: "Compacting context" };
  }
  if (status?.isBashRunning === true) {
    return { kind: "working", detail: "Running a command" };
  }
  // Deliberately no detail from the activity label. Those labels narrate the
  // agent loop -- "turn start", "message started", "receiving response",
  // "running tool" -- which churns every few hundred milliseconds and tells a
  // reader nothing they can act on. `Working` already says the session is busy;
  // the row's live-work counts say how busy. Compaction and a running command
  // keep their wording because each names a specific thing to wait for.
  if (status?.isStreaming === true) return { kind: "working" };
  if (activity?.phase === "active") return { kind: "working" };

  if (isUnread) {
    return unreadCompletedAt !== undefined
      ? { kind: "unread", completedAt: unreadCompletedAt }
      : { kind: "unread" };
  }

  return { kind: "open" };
}

// ---------------------------------------------------------------------------
// Board row and group types
// ---------------------------------------------------------------------------

export interface SessionBoardRow<S extends SessionBoardSessionInput> {
  readonly session: S;
  readonly state: SessionBoardState;
  readonly location: SessionBoardLocation;
}

export interface SessionBoardGroup<S extends SessionBoardSessionInput> extends BoardGroupDescriptor {
  readonly rows: readonly SessionBoardRow<S>[];
}

export type BoardCounts = Record<BoardGroupKind, number>;

export interface SessionBoard<S extends SessionBoardSessionInput> {
  readonly groups: readonly SessionBoardGroup<S>[];
  readonly rows: readonly SessionBoardRow<S>[];
  readonly counts: BoardCounts;
}

// ---------------------------------------------------------------------------
// deriveSessionBoard — build the full board
// ---------------------------------------------------------------------------

export interface SessionBoardInput<S extends SessionBoardSessionInput> {
  readonly sessions: readonly S[];
  /** Statuses keyed by session id; only sessions with live runtimes need entries. */
  readonly statuses?: Readonly<Record<string, SessionBoardStatusInput>>;
  /** Activities keyed by session id. */
  readonly activities?: Readonly<Record<string, SessionBoardActivityInput>>;
  /** Set of session ids the user has not yet seen. */
  readonly unreadSessionIds?: ReadonlySet<string>;
  /** ISO timestamps of when unread sessions were completed, keyed by session id. */
  readonly unreadCompletedAt?: Readonly<Record<string, string>>;
  /** Derives display location for a session. */
  readonly locationOf: (session: S) => SessionBoardLocation;
}

/**
 * Build the whole board.
 *
 * Returns every group in `BOARD_GROUPS` order, including empty ones, so the
 * caller decides what to do with an empty group rather than guessing why it
 * is missing.
 */
export interface SessionInboxProjection<S extends SessionBoardSessionInput> {
  readonly sessions: readonly S[];
  readonly statuses: Readonly<Record<string, SessionBoardStatusInput>>;
  readonly activities: Readonly<Record<string, SessionBoardActivityInput>>;
}

export interface SessionInboxBoardInput<S extends SessionBoardSessionInput>
  extends Omit<SessionBoardInput<S>, "sessions" | "statuses" | "activities"> {
  readonly projection: SessionInboxProjection<S>;
}

/** Canonical inbox projection from machine state plus browser-local unread/location state. */
export function deriveSessionInboxBoard<S extends SessionBoardSessionInput>(
  input: SessionInboxBoardInput<S>,
): SessionBoard<S> {
  return deriveSessionBoard({
    sessions: input.projection.sessions.filter((session) => session.agentSpawned !== true),
    statuses: input.projection.statuses,
    activities: input.projection.activities,
    ...(input.unreadSessionIds === undefined ? {} : { unreadSessionIds: input.unreadSessionIds }),
    ...(input.unreadCompletedAt === undefined ? {} : { unreadCompletedAt: input.unreadCompletedAt }),
    locationOf: input.locationOf,
  });
}

export function deriveSessionBoard<S extends SessionBoardSessionInput>(
  input: SessionBoardInput<S>,
): SessionBoard<S> {
  const rows: SessionBoardRow<S>[] = input.sessions.map((session) => {
    const state = sessionBoardState(session, {
      status: input.statuses?.[session.id],
      activity: input.activities?.[session.id],
      isUnread: input.unreadSessionIds?.has(session.id) === true,
      unreadCompletedAt: input.unreadCompletedAt?.[session.id],
    });
    return { session, state, location: input.locationOf(session) };
  });

  const groups: SessionBoardGroup<S>[] = BOARD_GROUPS.map((descriptor) => ({
    ...descriptor,
    rows: rows
      .filter((row) => row.state.kind === descriptor.kind)
      .sort(byPinnedThenRecency),
  }));

  return { groups, rows, counts: countsByKind(rows) };
}

// ---------------------------------------------------------------------------
// groupSessionsByProject — alternate project-grouped view
// ---------------------------------------------------------------------------

export interface ProjectBoardGroup<S extends SessionBoardSessionInput> {
  /** The project id. Used as the group's stable key. */
  readonly kind: string;
  readonly label: string;
  readonly hint: string;
  readonly tone: "muted";
  readonly rows: readonly SessionBoardRow<S>[];
}

export interface ProjectBoard<S extends SessionBoardSessionInput> {
  readonly groups: readonly ProjectBoardGroup<S>[];
  readonly rows: readonly SessionBoardRow<S>[];
  readonly counts: BoardCounts;
}

export interface GroupSessionsByProjectOptions {
  readonly includeArchived?: boolean;
}

/**
 * The same rows, grouped by project instead of by state.
 *
 * This is the "Group by: Project" toggle. It is the old hierarchy expressed as
 * one view among several, rather than as the only way to reach a session.
 * Archived sessions are excluded by default; pass `{ includeArchived: true }`
 * to include them.
 */
export function groupSessionsByProject<S extends SessionBoardSessionInput>(
  board: SessionBoard<S>,
  options: GroupSessionsByProjectOptions = {},
): ProjectBoard<S> {
  const includeArchived = options.includeArchived === true;
  const filteredRows = board.rows.filter(
    (row) => includeArchived || row.state.kind !== "archived",
  );

  const byProject = new Map<string, ProjectBoardGroup<S> & { rows: SessionBoardRow<S>[] }>();
  for (const row of filteredRows) {
    const key = row.location.projectId;
    const existing = byProject.get(key);
    if (existing === undefined) {
      byProject.set(key, {
        kind: key,
        label: row.location.projectName,
        hint: row.location.projectPath,
        tone: "muted",
        rows: [row],
      });
    } else {
      existing.rows.push(row);
    }
  }

  const groups = [...byProject.values()];
  for (const group of groups) {
    group.rows.sort(byPinnedThenRecency);
  }
  groups.sort(
    (a, b) =>
      attentionWeightOfGroup(b) - attentionWeightOfGroup(a) ||
      a.label.localeCompare(b.label),
  );

  return { groups, rows: board.rows, counts: board.counts };
}

// ---------------------------------------------------------------------------
// groupIdleSessionsByAge — the Open pile, split by age
// ---------------------------------------------------------------------------

export interface AgeBandGroup<S extends SessionBoardSessionInput> extends AgeBandDescriptor {
  readonly rows: readonly SessionBoardRow<S>[];
}

/**
 * The `open` group's rows, split into age bands.
 *
 * Only idle rows are banded. Blocked, errored, working and unread rows keep
 * their own groups above: those states say what a session wants from you now,
 * and age cannot say that. Empty bands are returned so the caller decides what
 * to do with them, matching `deriveSessionBoard`.
 */
export function groupIdleSessionsByAge<S extends SessionBoardSessionInput>(
  board: SessionBoard<S>,
  now: number,
): readonly AgeBandGroup<S>[] {
  const idle = board.rows.filter((row) => row.state.kind === "open");
  return AGE_BANDS.map((band) => ({
    ...band,
    rows: idle
      .filter((row) => ageBandKind(row.session.modified, now) === band.kind)
      .sort(byPinnedThenRecency),
  }));
}

// ---------------------------------------------------------------------------
// triageQueue — ordered triage
// ---------------------------------------------------------------------------

/**
 * Ordered triage queue: sessions that actually want you, most urgent first.
 *
 * Derived from the same board, so the queue can never disagree with the list.
 */
export function triageQueue<S extends SessionBoardSessionInput>(
  board: SessionBoard<S>,
): readonly SessionBoardRow<S>[] {
  const urgent = new Set<BoardGroupKind>(["blocked", "errored", "unread"]);
  return board.groups
    .filter((group) => urgent.has(group.kind))
    .flatMap((group) => group.rows);
}

// ---------------------------------------------------------------------------
// attentionCount — summary badge count
// ---------------------------------------------------------------------------

/** Count of sessions that want something from you. Drives the header summary. */
export function attentionCount<S extends SessionBoardSessionInput>(
  board: SessionBoard<S>,
): number {
  return board.counts.blocked + board.counts.errored + board.counts.unread;
}

// ---------------------------------------------------------------------------
// relativeTime — UTC-safe relative timestamp
// ---------------------------------------------------------------------------

/**
 * Human-readable elapsed time, UTC-safe.
 *
 * `iso` arrives as an ISO string that originated as UTC, so this only ever
 * does arithmetic on epoch milliseconds — never local-time part accessors.
 *
 * Boundaries: <60s → "now", <60m → Xm, <24h → Xh, <7d → Xd, ≥7d → Xw.
 */
export function relativeTime(iso: string, now: number): string {
  const elapsedSeconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (elapsedSeconds < 60) return "now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return `${String(Math.floor(days / 7))}w`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Pinned rows first, then recency. Pinning is an ordering promise ("top of
 * its grouped list"), not a state: the row still lives in whichever group
 * classification put it in.
 */
function byPinnedThenRecency<S extends SessionBoardSessionInput>(
  a: SessionBoardRow<S>,
  b: SessionBoardRow<S>,
): number {
  const pinnedDelta = Number(b.session.pinned === true) - Number(a.session.pinned === true);
  if (pinnedDelta !== 0) return pinnedDelta;
  return Date.parse(b.session.modified) - Date.parse(a.session.modified);
}

function countsByKind<S extends SessionBoardSessionInput>(
  rows: readonly SessionBoardRow<S>[],
): BoardCounts {
  const counts: BoardCounts = {
    blocked: 0,
    errored: 0,
    working: 0,
    unread: 0,
    open: 0,
    archived: 0,
  };
  for (const row of rows) {
    counts[row.state.kind] += 1;
  }
  return counts;
}

function attentionWeightOfGroup<S extends SessionBoardSessionInput>(
  group: { rows: readonly SessionBoardRow<S>[] },
): number {
  return group.rows.reduce((total, row) => total + stateWeight(row.state.kind), 0);
}

function stateWeight(kind: BoardGroupKind): number {
  const index = GROUP_KINDS.indexOf(kind);
  return index < 0 ? 0 : GROUP_KINDS.length - index;
}
