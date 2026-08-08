/**
 * Pure derivation: a flat list of sessions -> an inbox board grouped by what
 * each session needs from you.
 *
 * This is the piece designed to graduate into `src/client/src/sessionBoard.ts`
 * more or less unchanged (plus types). It has no I/O, no DOM, and no clock of
 * its own — `now` is passed in — so it is directly unit-testable.
 *
 * Every input field mirrors a real shape already on the wire:
 *   session   -> `SessionInfo`      (src/shared/apiTypes.ts)
 *   status    -> `SessionStatus`    (pendingAsk, pendingDialogs, isStreaming, …)
 *   activity  -> `SessionActivity`  (phase: "active" | "idle" | "error")
 *   unreadIds -> ids present in `SessionUnreadCatalogSnapshot`
 *
 * No new agent-side data is required for any of this.
 */

/**
 * The set of states a session can be in, in triage order.
 *
 * This array is the single source of truth for the case list. Labels, order,
 * counts, empty states, and the rendering loop all read from here — nothing
 * keeps a second hand-written copy.
 */
export const BOARD_GROUPS = [
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
];

const GROUP_KINDS = BOARD_GROUPS.map((group) => group.kind);

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
export function sessionBoardState(session, context = {}) {
  const status = context.status;
  const activity = context.activity;
  const isUnread = context.isUnread === true;

  if (session.archived === true) {
    return { kind: "archived", archivedAt: session.archivedAt };
  }

  const pendingDialogCount = status?.pendingDialogs?.length ?? 0;
  if (status?.pendingAsk != null) {
    return { kind: "blocked", reason: "ask", question: status.pendingAsk.summary };
  }
  if (pendingDialogCount > 0) {
    return { kind: "blocked", reason: "dialog", question: status.pendingDialogs[0].summary };
  }

  if (activity?.phase === "error") {
    return { kind: "errored", detail: activity.label };
  }

  if (status?.isCompacting === true) return { kind: "working", detail: "Compacting context" };
  if (status?.isBashRunning === true) return { kind: "working", detail: "Running a command" };
  if (status?.isStreaming === true) return { kind: "working", detail: activity?.label ?? "Thinking" };
  if (activity?.phase === "active") return { kind: "working", detail: activity.label ?? "Working" };

  if (isUnread) {
    return { kind: "unread", completedAt: context.unreadCompletedAt };
  }

  return { kind: "open" };
}

/**
 * Build the whole board.
 *
 * Returns every group in `BOARD_GROUPS` order, including empty ones, so the
 * caller decides what to do with an empty group rather than guessing why it is
 * missing.
 */
export function deriveSessionBoard(input) {
  const rows = input.sessions.map((session) => {
    const state = sessionBoardState(session, {
      status: input.statuses?.[session.id],
      activity: input.activities?.[session.id],
      isUnread: input.unreadSessionIds?.has(session.id) === true,
      unreadCompletedAt: input.unreadCompletedAt?.[session.id],
    });
    return { session, state, location: input.locationOf(session) };
  });

  const groups = BOARD_GROUPS.map((group) => ({
    ...group,
    rows: rows
      .filter((row) => row.state.kind === group.kind)
      .sort(byRecencyDescending),
  }));

  return { groups, rows, counts: countsByKind(rows) };
}

/**
 * The same rows, grouped by project instead of by state.
 *
 * This is the "Group by: Project" toggle. It is the old hierarchy expressed as
 * one view among several, rather than as the only way to reach a session.
 */
export function groupSessionsByProject(board, options = {}) {
  const includeArchived = options.includeArchived === true;
  const rows = board.rows.filter((row) => includeArchived || row.state.kind !== "archived");
  const byProject = new Map();

  for (const row of rows) {
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
  for (const group of groups) group.rows.sort(byRecencyDescending);
  groups.sort((a, b) => attentionWeight(b) - attentionWeight(a) || a.label.localeCompare(b.label));
  return { groups, rows: board.rows, counts: board.counts };
}

/**
 * Ordered triage queue: the sessions that actually want you, most urgent first.
 *
 * This is what a later "work through them one at a time" mode would walk. It
 * is derived from the same board, so the queue can never disagree with the list.
 */
export function triageQueue(board) {
  const urgent = new Set(["blocked", "errored", "unread"]);
  return board.groups
    .filter((group) => urgent.has(group.kind))
    .flatMap((group) => group.rows);
}

/** Count of sessions that want something from you. Drives the header summary. */
export function attentionCount(board) {
  return board.counts.blocked + board.counts.errored + board.counts.unread;
}

function countsByKind(rows) {
  const counts = Object.fromEntries(GROUP_KINDS.map((kind) => [kind, 0]));
  for (const row of rows) counts[row.state.kind] += 1;
  return counts;
}

function attentionWeight(group) {
  return group.rows.reduce((total, row) => total + stateWeight(row.state.kind), 0);
}

function stateWeight(kind) {
  const index = GROUP_KINDS.indexOf(kind);
  return index < 0 ? 0 : GROUP_KINDS.length - index;
}

function byRecencyDescending(a, b) {
  return Date.parse(b.session.modified) - Date.parse(a.session.modified);
}

/**
 * Relative time, UTC-safe.
 *
 * `modified` arrives as an ISO string that originated as UTC, so this only ever
 * does arithmetic on epoch milliseconds — never local-time part accessors.
 */
export function relativeTime(iso, now) {
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
