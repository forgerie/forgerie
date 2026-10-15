import { describe, expect, it } from "vitest";
import { ageBand, attention, capPinned, createLocationResolver, navigable, PINNED_VISIBLE, rowState, rows, sections, shortAge, type BoardInput, type PickerSession } from "./board";

const NOW = new Date(2026, 8, 29, 18, 40).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const session = (id: string, extra: Partial<PickerSession> = {}): PickerSession => ({ id, cwd: "/code/forgerie", modified: ago(5), ...extra });
const locate = createLocationResolver(
  [{ id: "p1", name: "forgerie", path: "/code/forgerie" }],
  [{ projectId: "p1", path: "/code/forgerie/.worktree/new-ui-mvp", label: "new-ui-mvp", isMain: false }],
);
function input(extra: Partial<BoardInput>): BoardInput {
  return { sessions: [], statuses: {}, activities: {}, unread: new Set(), locate, now: NOW, ...extra };
}

describe("row state", () => {
  it("treats an undeclared completion as unread work, not a response request", () => {
    const completed = session("a", { response: { kind: "needs-response", reason: "undeclared" } });
    expect(rowState(completed, idle, undefined, true)).toBe("unread");
    expect(rowState(completed, idle, undefined, false)).toBe("open");
    expect(attention(rows(input({ sessions: [completed] })))).toBeUndefined();
  });
  it("keeps an explicit question request after its completion is read", () => {
    const question = session("a", { response: { kind: "needs-response", reason: "questions" } });
    expect(rowState(question, idle, undefined, false)).toBe("blocked");
  });
  it("keeps the response request when unread clears, without guessing from text", () => {
    const waiting = session("a", { response: { kind: "needs-response", reason: "reply" } });
    expect(rowState(waiting, idle, undefined, true)).toBe("blocked");
    expect(rowState(waiting, idle, undefined, false)).toBe("blocked");
    expect(rowState(session("b", { name: "Can you answer this?", response: { kind: "none" } }), idle, undefined, true)).toBe("unread");
  });
  it("puts current work and errors before a request, and trusts live declaration data over cached data", () => {
    const waiting = session("a", { response: { kind: "needs-response", reason: "reply" } });
    expect(rowState(waiting, { ...idle, isStreaming: true }, undefined, true)).toBe("working");
    expect(rowState(waiting, idle, { phase: "error" }, true)).toBe("errored");
    expect(rowState(waiting, { ...idle, needsResponse: false }, undefined, true)).toBe("unread");
  });
  it("keeps an idle session whose pull request the agent watches in Working, unless it asks for a response", () => {
    const off = { provider: "github" as const, session: { id: "a", cwd: "/code/forgerie" }, repo: "o/r", number: 1, watch: { kind: "off" as const } };
    // One watched pull request among several is enough.
    const watched = session("a", { pullRequests: [off, { ...off, number: 2, watch: { kind: "watching", since: ago(10), wakes: 0 } }] });
    expect(rowState(watched, idle, undefined, true)).toBe("working");
    expect(rowState(session("b"), { ...idle, watchingPullRequest: true }, undefined, false)).toBe("working");
    expect(rowState(session("c"), { ...idle, watchingPullRequest: true, needsResponse: true }, undefined, false)).toBe("blocked");
    expect(rowState(session("d", { pullRequests: [off, { ...off, number: 2, watch: { kind: "stopped", reason: "Merged.", at: ago(1) } }] }), idle, undefined, false)).toBe("open");
  });
  it("keeps an idle session whose agents are still working in Working, unless it asks for a response", () => {
    expect(rowState(session("a"), { ...idle, workingAgents: 2 }, { phase: "idle" }, true)).toBe("working");
    expect(rowState(session("b"), { ...idle, workingAgents: 1, needsResponse: true }, undefined, false)).toBe("blocked");
    expect(rowState(session("c"), { ...idle, workingAgents: 0 }, undefined, false)).toBe("open");
    // A running process alone, such as a dev server, does not count as work in progress.
    expect(rowState(session("d"), { ...idle, runningProcesses: 1 }, undefined, false)).toBe("open");
  });
  it("ranks archived over blocked over errored over working over unread", () => {
    const s = session("a");
    expect(rowState({ ...s, archived: true }, { ...idle, blocked: true }, undefined, true)).toBe("archived");
    expect(rowState(s, { ...idle, blocked: true, isStreaming: true }, { phase: "error" }, true)).toBe("blocked");
    expect(rowState(s, { ...idle, isStreaming: true }, { phase: "error" }, true)).toBe("errored");
    expect(rowState(s, { ...idle, isCompacting: true }, undefined, true)).toBe("working");
    expect(rowState(s, undefined, { phase: "active" }, true)).toBe("working");
    expect(rowState(s, idle, { phase: "idle" }, true)).toBe("unread");
    expect(rowState(s, undefined, undefined, false)).toBe("open");
  });
});

describe("time", () => {
  it("is always shorthand, never a clock", () => {
    expect(shortAge(ago(0.5), NOW)).toBe("<1m");
    expect(shortAge(ago(41), NOW)).toBe("41m");
    expect(shortAge(ago(130), NOW)).toBe("2h");
    expect(shortAge(ago(60 * 24 * 3), NOW)).toBe("3d");
    expect(shortAge(ago(60 * 24 * 15), NOW)).toBe("2w");
  });
  it("shows how long the current run has lasted while working", () => {
    const [row] = rows(input({ sessions: [session("w", { modified: ago(1) })], statuses: { w: { ...idle, isStreaming: true } }, activities: { w: { phase: "active", activeSince: ago(41) } } }));
    expect(row).toMatchObject({ state: "working", working: true, time: "41m" });
  });
  it("bands idle sessions by local calendar day", () => {
    expect(ageBand(ago(30), NOW)).toBe("hour");
    expect(ageBand(ago(120), NOW)).toBe("today");
    expect(ageBand(new Date(2026, 8, 28, 23, 0).toISOString(), NOW)).toBe("yesterday");
    expect(ageBand(new Date(2026, 8, 25).toISOString(), NOW)).toBe("week");
    expect(ageBand(new Date(2026, 5, 1).toISOString(), NOW)).toBe("older");
  });
});

describe("location", () => {
  it("names the project, and the branch only off the main checkout", () => {
    expect(locate("/code/forgerie")).toEqual({ projectKey: "p1", project: "forgerie" });
    expect(locate("/code/forgerie/.worktree/new-ui-mvp/")).toEqual({ projectKey: "p1", project: "forgerie", branch: "new-ui-mvp" });
    expect(locate("/code/forgerie/.worktrees/fix/lock")).toEqual({ projectKey: "p1", project: "forgerie", branch: "lock" });
  });
  it("falls back to the last path segment for an unregistered cwd", () => {
    expect(locate("/tmp/scratch")).toEqual({ projectKey: "/tmp/scratch", project: "scratch" });
    expect(locate("/code/forgerie-other")).toEqual({ projectKey: "/code/forgerie-other", project: "forgerie-other" });
  });
});

describe("sections", () => {
  const all = rows(input({
    sessions: [
      session("pin", { pinned: true }), session("ask"), session("old", { modified: ago(60 * 24 * 10) }),
      session("new", { modified: ago(2) }), session("arc", { archived: true }), session("kid", { agentSpawned: true }),
    ],
    statuses: { ask: { ...idle, blocked: true }, pin: { ...idle, blocked: true, workingAgents: 3, runningProcesses: 1 } },
  }));

  it("hides agent-spawned sessions", () => {
    expect(all.map((row) => row.session.id)).not.toContain("kid");
  });
  it("lifts pinned rows but keeps their state and live work", () => {
    expect(all.find((row) => row.session.id === "pin")).toMatchObject({ group: "pinned", state: "blocked", agents: 3, processes: 1 });
  });
  it("orders groups by triage and splits Open into age bands", () => {
    const list = sections(all, { grouping: "state", showArchived: false, now: NOW });
    expect(list.map((section) => section.key)).toEqual(["pinned", "blocked", "hour", "month"]);
  });
  it("shows Archived only when asked", () => {
    expect(sections(all, { grouping: "state", showArchived: true, now: NOW }).at(-1)?.key).toBe("archived");
  });
  it("groups by project as the other mode", () => {
    const list = sections(all, { grouping: "project", showArchived: false, now: NOW });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "project", label: "forgerie" });
  });
  it("walks only expanded groups, in drawn order", () => {
    const list = sections(all, { grouping: "state", showArchived: false, now: NOW });
    expect(navigable(list, new Set(["month"])).map((row) => row.session.id)).toEqual(["pin", "ask", "new"]);
  });
  it("caps Pinned but never hides a pin that wants you or the open session", () => {
    const pins = rows(input({
      sessions: Array.from({ length: 12 }, (_, index) => session(`p${String(index)}`, { pinned: true, modified: ago(index + 1) })),
      statuses: { p9: { ...idle, blocked: true }, p10: { ...idle, isStreaming: true } },
    }));
    const plain = capPinned(pins.filter((row) => row.state === "open"), undefined);
    expect(plain.rows.map((row) => row.session.id)).toEqual(["p0", "p1", "p2"]);
    expect(plain.rows).toHaveLength(PINNED_VISIBLE);
    const urgent = capPinned(pins, "p7");
    // p9 blocked, p10 working, and p7 open all show; nothing else fits.
    expect(urgent.rows.map((row) => row.session.id)).toEqual(["p7", "p9", "p10"]);
    expect(urgent.hidden).toBe(9);
    const list = sections(pins, { grouping: "state", showArchived: false, now: NOW, selectedId: "p7" });
    expect(list[0]).toMatchObject({ key: "pinned", hidden: 9 });
    const expanded = sections(pins, { grouping: "state", showArchived: false, now: NOW, allPinned: true });
    expect(expanded[0]).not.toHaveProperty("hidden");
    expect(expanded[0]?.rows).toHaveLength(12);
  });
  it("reports blocked over unread for the closed picker", () => {
    expect(attention(all)).toBe("blocked");
    expect(attention(rows(input({ sessions: [session("u")], unread: new Set(["u"]) })))).toBe("unread");
    expect(attention(rows(input({ sessions: [session("o")] })))).toBeUndefined();
  });
});

describe("attention hints", () => {
  const hint = { turnId: "turn-1", at: ago(0), model: "fast", likelyNeedsYou: true, kind: "review" as const, urgency: "high" as const };
  it("only promotes Unread and leaves declared reply rows and other states unchanged", () => {
    const status = { ...idle, attentionHint: hint };
    const [promoted] = rows(input({ sessions: [session("a")], statuses: { a: status }, unread: new Set(["a"]) }));
    expect(promoted).toMatchObject({ state: "blocked", group: "blocked", likelyNeedsYou: true, attentionKind: "review" });
    const reply = session("b", { response: { kind: "needs-response", reason: "reply" } });
    expect(rowState(reply, { ...status, attentionHint: { ...hint, likelyNeedsYou: false } }, undefined, false)).toBe("blocked");
    expect(rowState(session("c"), status, undefined, false)).toBe("open");
    expect(rowState(session("c"), status, { phase: "error" }, true)).toBe("errored");
    expect(rowState(session("c", { archived: true }), status, undefined, true)).toBe("archived");
    expect(rowState(session("c"), { ...status, workingAgents: 1 }, undefined, true)).toBe("working");
    expect(rowState(session("c"), { ...status, attentionHint: { ...hint, likelyNeedsYou: false } }, undefined, true)).toBe("unread");
  });
  it("orders Needs your response by urgency then recency, with pins first", () => {
    const all = rows(input({
      sessions: [session("low", { modified: ago(1) }), session("high-old", { modified: ago(30) }), session("high-new", { modified: ago(2) }), session("normal"), session("pin", { pinned: true })],
      statuses: Object.fromEntries(["low", "high-old", "high-new", "normal", "pin"].map((id) => [id, { ...idle, attentionHint: { ...hint, urgency: id === "low" || id === "pin" ? "low" : id === "normal" ? "normal" : "high" } }])),
      unread: new Set(["low", "high-old", "high-new", "normal", "pin"]),
    }));
    expect(sections(all, { grouping: "state", showArchived: false, now: NOW }).flatMap((section) => section.rows).map((row) => row.session.id)).toEqual(["pin", "high-new", "high-old", "normal", "low"]);
  });
  it("ignores a previous hint while a new turn runs and clears promotion when its status arrives", () => {
    const s = session("a");
    expect(rows(input({ sessions: [s], statuses: { a: { ...idle, isStreaming: true, attentionHint: hint } }, unread: new Set(["a"]) }))[0]).toMatchObject({ state: "working" });
    expect(rows(input({ sessions: [s], statuses: { a: idle }, unread: new Set(["a"]) }))[0]).toMatchObject({ state: "unread" });
  });
});

it("keeps required-response rows hint-free in today's order and before inferred rows", () => {
  const hint = { turnId: "turn", at: ago(0), model: "fast", likelyNeedsYou: true, kind: "review" as const, urgency: "high" as const };
  const sessions = [session("declared-old", { modified: ago(30), response: { kind: "needs-response", reason: "reply" } }), session("declared-new", { modified: ago(20), response: { kind: "needs-response", reason: "reply" } }), session("dialog", { modified: ago(10) }), session("hint-new", { modified: ago(1) }), session("hint-high", { modified: ago(5) })];
  const statuses = { "declared-new": { ...idle, attentionHint: { ...hint, urgency: "low" as const } }, "declared-old": { ...idle, attentionHint: hint }, dialog: { ...idle, blocked: true, attentionHint: hint }, "hint-new": { ...idle, attentionHint: { ...hint, urgency: "normal" as const } }, "hint-high": { ...idle, attentionHint: hint } };
  const all = rows(input({ sessions, statuses, unread: new Set(sessions.map(s => s.id)) }));
  for (const row of all.filter(row => !row.session.id.startsWith("hint-"))) {
    expect(row).not.toHaveProperty("attentionKind"); expect(row).not.toHaveProperty("urgency"); expect(row).not.toHaveProperty("likelyNeedsYou");
  }
  expect(sections(all, { grouping: "state", showArchived: false, now: NOW }).flatMap(section => section.rows).map(row => row.session.id)).toEqual(["dialog", "declared-new", "declared-old", "hint-high", "hint-new"]);
});
