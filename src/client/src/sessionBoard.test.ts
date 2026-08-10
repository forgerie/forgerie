import { describe, expect, it } from "vitest";
import {
  BOARD_GROUPS,
  attentionCount,
  deriveSessionBoard,
  deriveSessionInboxBoard,
  groupSessionsByProject,
  relativeTime,
  sessionBoardState,
  triageQueue,
  type SessionBoardActivityInput,
  type SessionBoardInput,
  type SessionBoardLocation,
  type SessionBoardSessionInput,
  type SessionBoardStatusInput,
} from "./sessionBoard";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestSession extends SessionBoardSessionInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
}

function mkSession(
  id: string,
  overrides: Partial<TestSession> = {},
): TestSession {
  return {
    id,
    modified: "2026-08-07T10:00:00.000Z",
    projectId: "proj-1",
    projectName: "Project One",
    projectPath: "/path/to/project",
    ...overrides,
  };
}

function mkStatus(overrides: Partial<SessionBoardStatusInput> = {}): SessionBoardStatusInput {
  return {
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    ...overrides,
  };
}

function mkActivity(overrides: Partial<SessionBoardActivityInput> = {}): SessionBoardActivityInput {
  return {
    phase: "idle",
    label: "Idle",
    ...overrides,
  };
}

function locationOf(s: TestSession): SessionBoardLocation {
  return {
    projectId: s.projectId,
    projectName: s.projectName,
    projectPath: s.projectPath,
  };
}

function mkBoard(
  sessions: TestSession[],
  options: Partial<Omit<SessionBoardInput<TestSession>, "sessions" | "locationOf">> = {},
) {
  return deriveSessionBoard<TestSession>({
    sessions,
    locationOf,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// BOARD_GROUPS — single source of truth
// ---------------------------------------------------------------------------

describe("BOARD_GROUPS", () => {
  it("lists exactly the six kinds in triage order", () => {
    expect(BOARD_GROUPS.map((g) => g.kind)).toEqual([
      "blocked",
      "errored",
      "working",
      "unread",
      "open",
      "archived",
    ]);
  });

  it("every entry has label, hint, and tone", () => {
    for (const group of BOARD_GROUPS) {
      expect(typeof group.label).toBe("string");
      expect(group.label.length).toBeGreaterThan(0);
      expect(typeof group.hint).toBe("string");
      expect(typeof group.tone).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// sessionBoardState — classification
// ---------------------------------------------------------------------------

describe("sessionBoardState", () => {
  describe("archived precedence", () => {
    it("returns archived when session.archived is true, even with a live streaming status", () => {
      const state = sessionBoardState(
        mkSession("s1", { archived: true, archivedAt: "2026-08-06T09:00:00.000Z" }),
        { status: mkStatus({ isStreaming: true }) },
      );
      expect(state.kind).toBe("archived");
      if (state.kind === "archived") {
        expect(state.archivedAt).toBe("2026-08-06T09:00:00.000Z");
      }
    });

    it("returns archived when session.archived is true and there is a pending ask", () => {
      const state = sessionBoardState(
        mkSession("s1", { archived: true }),
        { status: mkStatus({ pendingAsk: { questions: [{ question: "Are you sure?" }] } }) },
      );
      expect(state.kind).toBe("archived");
    });
  });

  describe("blocked precedence", () => {
    it("returns blocked(ask) when pendingAsk is set, even with an error-phase activity", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({ pendingAsk: { questions: [{ question: "Continue?" }] } }),
          activity: mkActivity({ phase: "error", label: "Tool error" }),
        },
      );
      expect(state).toMatchObject({ kind: "blocked", reason: "ask", question: "Continue?" });
    });

    it("uses the first question's text as the question", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({
            pendingAsk: {
              questions: [
                { question: "First?" },
                { question: "Second?" },
              ],
            },
          }),
        },
      );
      if (state.kind !== "blocked" || state.reason !== "ask") throw new Error("expected blocked/ask");
      expect(state.question).toBe("First?");
    });

    it("returns blocked(dialog) when pendingDialogs is non-empty and there is no pendingAsk", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({
            pendingDialogs: [{ title: "Allow access?" }],
          }),
        },
      );
      expect(state).toMatchObject({ kind: "blocked", reason: "dialog", question: "Allow access?" });
    });

    it("ask beats dialog when both are present", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({
            pendingAsk: { questions: [{ question: "Ask question" }] },
            pendingDialogs: [{ title: "Dialog title" }],
          }),
        },
      );
      expect(state).toMatchObject({ kind: "blocked", reason: "ask" });
    });
  });

  describe("errored", () => {
    it("returns errored when activity phase is error and session is not blocked", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { activity: mkActivity({ phase: "error", label: "Command failed" }) },
      );
      expect(state).toMatchObject({ kind: "errored", detail: "Command failed" });
    });
  });

  describe("working", () => {
    it("isCompacting → working with 'Compacting context'", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { status: mkStatus({ isCompacting: true }) },
      );
      expect(state).toMatchObject({ kind: "working", detail: "Compacting context" });
    });

    it("isBashRunning → working with 'Running a command'", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { status: mkStatus({ isBashRunning: true }) },
      );
      expect(state).toMatchObject({ kind: "working", detail: "Running a command" });
    });

    it("isStreaming → working with activity label when activity is present", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({ isStreaming: true }),
          activity: mkActivity({ phase: "active", label: "Analyzing code" }),
        },
      );
      expect(state).toMatchObject({ kind: "working", detail: "Analyzing code" });
    });

    it("isStreaming → working with fallback 'Thinking' when no activity label", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { status: mkStatus({ isStreaming: true }) },
      );
      expect(state).toMatchObject({ kind: "working", detail: "Thinking" });
    });

    it("phase 'active' with no flags → working", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { activity: mkActivity({ phase: "active", label: "Running" }) },
      );
      expect(state).toMatchObject({ kind: "working", detail: "Running" });
    });

    it("streaming wins over unread", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus({ isStreaming: true }),
          isUnread: true,
        },
      );
      expect(state.kind).toBe("working");
    });
  });

  describe("unread", () => {
    it("returns unread when isUnread is true and no status/activity entries", () => {
      const state = sessionBoardState(mkSession("s1"), { isUnread: true });
      expect(state).toMatchObject({ kind: "unread" });
    });

    it("carries the completedAt timestamp when provided", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        { isUnread: true, unreadCompletedAt: "2026-08-07T09:30:00.000Z" },
      );
      if (state.kind !== "unread") throw new Error("expected unread");
      expect(state.completedAt).toBe("2026-08-07T09:30:00.000Z");
    });
  });

  describe("open fallback", () => {
    it("returns open when session has no status, activity, or unread marker", () => {
      const state = sessionBoardState(mkSession("s1"), {});
      expect(state).toMatchObject({ kind: "open" });
    });

    it("returns open when status has no flags set and activity is idle", () => {
      const state = sessionBoardState(
        mkSession("s1"),
        {
          status: mkStatus(),
          activity: mkActivity({ phase: "idle" }),
        },
      );
      expect(state).toMatchObject({ kind: "open" });
    });
  });
});

// ---------------------------------------------------------------------------
// deriveSessionBoard — board construction
// ---------------------------------------------------------------------------

describe("deriveSessionBoard", () => {
  it("returns every group in BOARD_GROUPS order, including empty ones", () => {
    const board = mkBoard([]);
    expect(board.groups.map((g) => g.kind)).toEqual(BOARD_GROUPS.map((g) => g.kind));
    for (const group of board.groups) {
      expect(group.rows).toHaveLength(0);
    }
  });

  it("places one session per state into its correct group", () => {
    const sessions = [
      mkSession("archived-one", { archived: true }),
      mkSession("open-one"),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        "open-one": mkStatus(),
      },
    });

    const archivedGroup = board.groups.find((g) => g.kind === "archived");
    expect(archivedGroup?.rows.map((r) => r.session.id)).toEqual(["archived-one"]);

    const openGroup = board.groups.find((g) => g.kind === "open");
    expect(openGroup?.rows.map((r) => r.session.id)).toEqual(["open-one"]);
  });

  it("counts by kind match the rows assigned to each group", () => {
    const sessions = [
      mkSession("s1", { archived: true }),
      mkSession("s2"),
      mkSession("s3"),
    ];
    const board = mkBoard(sessions);

    expect(board.counts.archived).toBe(1);
    expect(board.counts.open).toBe(2);
    expect(board.counts.blocked + board.counts.errored + board.counts.working + board.counts.unread).toBe(0);
  });

  it("sorts rows within a group by modified descending (most recent first)", () => {
    const sessions = [
      mkSession("older", { modified: "2026-08-05T10:00:00.000Z" }),
      mkSession("newer", { modified: "2026-08-07T10:00:00.000Z" }),
      mkSession("middle", { modified: "2026-08-06T10:00:00.000Z" }),
    ];
    const board = mkBoard(sessions);
    const openGroup = board.groups.find((g) => g.kind === "open");
    expect(openGroup?.rows.map((r) => r.session.id)).toEqual(["newer", "middle", "older"]);
  });

  it("each row carries the location returned by locationOf", () => {
    const sessions = [
      mkSession("s1", { projectId: "proj-x", projectName: "X", projectPath: "/x" }),
    ];
    const board = mkBoard(sessions);
    const row = board.rows[0];
    expect(row?.location).toEqual({ projectId: "proj-x", projectName: "X", projectPath: "/x" });
  });

  it("resolves statuses and activities by session id from the input records", () => {
    const sessions = [mkSession("blocked-one")];
    const board = mkBoard(sessions, {
      statuses: {
        "blocked-one": mkStatus({ pendingAsk: { questions: [{ question: "Proceed?" }] } }),
      },
    });
    const row = board.rows[0];
    expect(row?.state.kind).toBe("blocked");
  });

  it("resolves unread session ids from the input set", () => {
    const sessions = [mkSession("unread-one")];
    const board = mkBoard(sessions, {
      unreadSessionIds: new Set(["unread-one"]),
    });
    const row = board.rows[0];
    expect(row?.state.kind).toBe("unread");
  });

  it("carries unreadCompletedAt through to the unread state", () => {
    const sessions = [mkSession("u1")];
    const board = mkBoard(sessions, {
      unreadSessionIds: new Set(["u1"]),
      unreadCompletedAt: { "u1": "2026-08-07T08:00:00.000Z" },
    });
    const row = board.rows[0];
    if (row?.state.kind !== "unread") throw new Error("expected unread");
    expect(row.state.completedAt).toBe("2026-08-07T08:00:00.000Z");
  });

  describe("precedence integration", () => {
    it("archived beats streaming", () => {
      const sessions = [mkSession("s1", { archived: true })];
      const board = mkBoard(sessions, {
        statuses: { s1: mkStatus({ isStreaming: true }) },
      });
      expect(board.rows[0]?.state.kind).toBe("archived");
    });

    it("blocked beats errored", () => {
      const sessions = [mkSession("s1")];
      const board = mkBoard(sessions, {
        statuses: { s1: mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }) },
        activities: { s1: mkActivity({ phase: "error" }) },
      });
      expect(board.rows[0]?.state.kind).toBe("blocked");
    });

    it("working beats unread", () => {
      const sessions = [mkSession("s1")];
      const board = mkBoard(sessions, {
        statuses: { s1: mkStatus({ isStreaming: true }) },
        unreadSessionIds: new Set(["s1"]),
      });
      expect(board.rows[0]?.state.kind).toBe("working");
    });
  });
});

// ---------------------------------------------------------------------------
// groupSessionsByProject — alternate view
// ---------------------------------------------------------------------------

describe("groupSessionsByProject", () => {
  it("groups rows by project id", () => {
    const sessions = [
      mkSession("a", { projectId: "proj-a", projectName: "Alpha", projectPath: "/alpha" }),
      mkSession("b", { projectId: "proj-b", projectName: "Beta", projectPath: "/beta" }),
      mkSession("c", { projectId: "proj-a", projectName: "Alpha", projectPath: "/alpha" }),
    ];
    const board = mkBoard(sessions);
    const byProject = groupSessionsByProject(board);

    expect(byProject.groups).toHaveLength(2);
    const alpha = byProject.groups.find((g) => g.kind === "proj-a");
    expect(alpha?.rows.map((r) => r.session.id).sort()).toEqual(["a", "c"]);
  });

  it("excludes archived sessions by default", () => {
    const sessions = [
      mkSession("live", { projectId: "proj-1", projectName: "P", projectPath: "/p" }),
      mkSession("done", { projectId: "proj-1", projectName: "P", projectPath: "/p", archived: true }),
    ];
    const board = mkBoard(sessions);
    const byProject = groupSessionsByProject(board);
    const group = byProject.groups.find((g) => g.kind === "proj-1");
    expect(group?.rows.map((r) => r.session.id)).toEqual(["live"]);
  });

  it("includes archived sessions when includeArchived is true", () => {
    const sessions = [
      mkSession("live", { projectId: "proj-1", projectName: "P", projectPath: "/p" }),
      mkSession("done", { projectId: "proj-1", projectName: "P", projectPath: "/p", archived: true }),
    ];
    const board = mkBoard(sessions);
    const byProject = groupSessionsByProject(board, { includeArchived: true });
    const group = byProject.groups.find((g) => g.kind === "proj-1");
    expect(group?.rows.map((r) => r.session.id).sort()).toEqual(["done", "live"]);
  });

  it("orders project groups by attention and their rows by recency", () => {
    const sessions = [
      mkSession("calm", { projectId: "proj-calm", projectName: "Calm", projectPath: "/calm" }),
      mkSession("urgent-older", {
        projectId: "proj-urgent",
        projectName: "Urgent",
        projectPath: "/urgent",
        modified: "2026-08-06T10:00:00.000Z",
      }),
      mkSession("urgent-newer", {
        projectId: "proj-urgent",
        projectName: "Urgent",
        projectPath: "/urgent",
        modified: "2026-08-08T10:00:00.000Z",
      }),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        "urgent-older": mkStatus({ pendingAsk: { questions: [{ question: "!" }] } }),
        "urgent-newer": mkStatus({ pendingAsk: { questions: [{ question: "!" }] } }),
      },
    });
    const byProject = groupSessionsByProject(board);
    expect(byProject.groups.map((group) => group.kind)).toEqual(["proj-urgent", "proj-calm"]);
    expect(byProject.groups[0]?.rows.map((row) => row.session.id)).toEqual(["urgent-newer", "urgent-older"]);
  });

  it("breaks attention-weight ties alphabetically by project name", () => {
    const sessions = [
      mkSession("z", { projectId: "proj-z", projectName: "Zebra", projectPath: "/z" }),
      mkSession("a", { projectId: "proj-a", projectName: "Alpha", projectPath: "/a" }),
    ];
    const board = mkBoard(sessions);
    const byProject = groupSessionsByProject(board);
    expect(byProject.groups.map((g) => g.kind)).toEqual(["proj-a", "proj-z"]);
  });
});

// ---------------------------------------------------------------------------
// triageQueue — ordered triage
// ---------------------------------------------------------------------------

describe("triageQueue", () => {
  it("contains exactly blocked, errored, and unread rows in BOARD_GROUPS order", () => {
    const sessions = [
      mkSession("blocked-one"),
      mkSession("errored-one"),
      mkSession("unread-one"),
      mkSession("open-one"),
      mkSession("working-one"),
      mkSession("archived-one", { archived: true }),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        "blocked-one": mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }),
        "working-one": mkStatus({ isStreaming: true }),
      },
      activities: {
        "errored-one": mkActivity({ phase: "error" }),
      },
      unreadSessionIds: new Set(["unread-one"]),
    });

    const queue = triageQueue(board);
    const queueKinds = queue.map((r) => r.state.kind);
    expect(queueKinds).not.toContain("open");
    expect(queueKinds).not.toContain("working");
    expect(queueKinds).not.toContain("archived");
    expect(queueKinds).toContain("blocked");
    expect(queueKinds).toContain("errored");
    expect(queueKinds).toContain("unread");
  });

  it("returns rows in group order: blocked before errored before unread", () => {
    const sessions = [
      mkSession("b"),
      mkSession("e"),
      mkSession("u"),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        b: mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }),
      },
      activities: { e: mkActivity({ phase: "error" }) },
      unreadSessionIds: new Set(["u"]),
    });

    const queue = triageQueue(board);
    expect(queue.map((r) => r.state.kind)).toEqual(["blocked", "errored", "unread"]);
  });

  it("orders by recency within each group", () => {
    const sessions = [
      mkSession("b-older", { modified: "2026-08-05T10:00:00.000Z" }),
      mkSession("b-newer", { modified: "2026-08-07T10:00:00.000Z" }),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        "b-older": mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }),
        "b-newer": mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }),
      },
    });

    const queue = triageQueue(board);
    expect(queue.map((r) => r.session.id)).toEqual(["b-newer", "b-older"]);
  });

  it("returns an empty queue when no session is blocked, errored, or unread", () => {
    const board = mkBoard([mkSession("open-one"), mkSession("archived-one", { archived: true })]);
    expect(triageQueue(board)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — summary count
// ---------------------------------------------------------------------------

describe("attentionCount", () => {
  it("sums blocked + errored + unread counts", () => {
    const sessions = [
      mkSession("b"),
      mkSession("e"),
      mkSession("u"),
      mkSession("open"),
      mkSession("archived", { archived: true }),
    ];
    const board = mkBoard(sessions, {
      statuses: {
        b: mkStatus({ pendingAsk: { questions: [{ question: "?" }] } }),
      },
      activities: { e: mkActivity({ phase: "error" }) },
      unreadSessionIds: new Set(["u"]),
    });

    expect(attentionCount(board)).toBe(3);
  });

  it("returns zero when nothing needs attention", () => {
    const board = mkBoard([mkSession("calm")]);
    expect(attentionCount(board)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// relativeTime — UTC-safe relative timestamps
// ---------------------------------------------------------------------------

describe("relativeTime", () => {
  const base = Date.parse("2026-08-07T12:00:00.000Z");

  it("returns 'now' for elapsed < 60 seconds", () => {
    expect(relativeTime("2026-08-07T11:59:01.000Z", base)).toBe("now");
    expect(relativeTime("2026-08-07T12:00:00.000Z", base)).toBe("now");
  });

  it("returns minutes for elapsed 60s to <60m", () => {
    expect(relativeTime("2026-08-07T11:59:00.000Z", base)).toBe("1m");
    expect(relativeTime("2026-08-07T11:01:00.000Z", base)).toBe("59m");
  });

  it("returns hours for elapsed 60m to <24h", () => {
    expect(relativeTime("2026-08-07T11:00:00.000Z", base)).toBe("1h");
    expect(relativeTime("2026-08-06T13:00:00.000Z", base)).toBe("23h");
  });

  it("returns days for elapsed 24h to <7d", () => {
    expect(relativeTime("2026-08-06T12:00:00.000Z", base)).toBe("1d");
    expect(relativeTime("2026-08-01T12:00:00.000Z", base)).toBe("6d");
  });

  it("returns weeks for elapsed ≥7d", () => {
    expect(relativeTime("2026-07-31T12:00:00.000Z", base)).toBe("1w");
    expect(relativeTime("2026-07-24T12:00:00.000Z", base)).toBe("2w");
  });

  it("clamps negative elapsed to zero (future timestamps return 'now')", () => {
    expect(relativeTime("2026-08-07T13:00:00.000Z", base)).toBe("now");
  });

  it("never uses local-time accessors — epoch arithmetic only", () => {
    // A timestamp near a daylight-saving boundary: if local-time getHours() were used
    // instead of UTC arithmetic, this would miscount. We verify arithmetic correctness
    // using a fixed UTC epoch so any local-clock-dependent path fails the boundary.
    const utcNow = Date.parse("2026-03-08T03:30:00.000Z"); // near US DST change
    expect(relativeTime("2026-03-08T02:30:00.000Z", utcNow)).toBe("1h");
  });
});

describe("agent-spawned sessions", () => {
  it("keeps agent-to-agent conversations off the board's top level", () => {
    const board = deriveSessionInboxBoard({
      projection: {
        sessions: [
          { id: "human", modified: "2026-08-10T10:00:00.000Z", cwd: "/repo" },
          { id: "delegated", modified: "2026-08-10T10:01:00.000Z", cwd: "/repo", agentSpawned: true },
        ],
        statuses: {},
        activities: {},
      },
      locationOf: () => ({ projectId: "p", projectName: "repo", projectPath: "/repo" }),
    });

    expect(board.rows.map((row) => row.session.id)).toEqual(["human"]);
  });

  it("keeps a session the user continued, which looks identical apart from the mark", () => {
    const board = deriveSessionInboxBoard({
      projection: {
        sessions: [
          { id: "continuation", modified: "2026-08-10T10:00:00.000Z", cwd: "/repo", parentSessionPath: "/s/original.jsonl" },
        ],
        statuses: {},
        activities: {},
      },
      locationOf: () => ({ projectId: "p", projectName: "repo", projectPath: "/repo" }),
    });

    expect(board.rows.map((row) => row.session.id)).toEqual(["continuation"]);
  });
});
