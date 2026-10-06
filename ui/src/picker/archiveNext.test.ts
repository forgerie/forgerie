import { describe, expect, it } from "vitest";
import { createLocationResolver, rows, type PickerSession, type PickerStatus } from "./board";
import { archiveAvailability, nextWaiting } from "./archiveNext";

const NOW = new Date(2026, 9, 5, 18, 0).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const locate = createLocationResolver([], []);
const S = (id: string, minutes: number, extra: Partial<PickerSession> = {}): PickerSession => ({ id, cwd: "/code/x", name: id, modified: ago(minutes), ...extra });
const idle: PickerStatus = { isStreaming: false, isCompacting: false, isBashRunning: false };
function board(sessions: PickerSession[], options: { statuses?: Record<string, PickerStatus>; unread?: string[]; errored?: string[] } = {}) {
  const activities = Object.fromEntries((options.errored ?? []).map((id) => [id, { phase: "error" as const }]));
  return rows({ sessions, statuses: options.statuses ?? {}, activities, unread: new Set(options.unread ?? []), locate, now: NOW });
}

describe("next waiting session", () => {
  it("goes to blocked, then errored, then unread; pinned first, then newest", () => {
    const all = board([S("current", 1), S("unread-old", 30), S("unread-new", 2), S("errored", 50), S("blocked", 90), S("blocked-pinned", 200, { pinned: true })], {
      statuses: { blocked: { ...idle, blocked: true }, "blocked-pinned": { ...idle, blocked: true } },
      unread: ["unread-old", "unread-new", "current"], errored: ["errored"],
    });
    const order: string[] = [];
    // Archive and next, repeated: each archived session leaves the list.
    let remaining = all.filter((row) => row.session.id !== "current");
    for (let next = nextWaiting(all, "current"); next; next = nextWaiting(remaining, next.session.id)) {
      order.push(next.session.id);
      const id = next.session.id;
      remaining = remaining.filter((row) => row.session.id !== id);
    }
    expect(order).toEqual(["blocked-pinned", "blocked", "errored", "unread-new", "unread-old"]);
  });

  it("skips the archived session itself, working and open sessions, archived ones, and spawned agents", () => {
    const all = board([S("current", 1), S("working", 2), S("open", 3), S("gone", 4, { archived: true }), S("child", 5, { agentSpawned: true })], {
      statuses: { working: { ...idle, isStreaming: true } }, unread: ["current", "gone", "child"],
    });
    expect(nextWaiting(all, "current")).toBeUndefined();
  });
});

describe("archive availability", () => {
  const row = (session: PickerSession, status?: PickerStatus) => board([session], status ? { statuses: { [session.id]: status } } : {})[0];

  it("is ready for an idle, unpinned session", () => {
    expect(archiveAvailability(row(S("a", 1)))).toEqual({ type: "ready" });
  });
  it("names why it cannot run, matching the server's refusals", () => {
    expect(archiveAvailability(undefined)).toEqual({ type: "blocked", reason: "Loading sessions" });
    expect(archiveAvailability(row(S("a", 1), { ...idle, isStreaming: true }))).toEqual({ type: "blocked", reason: "Stop the run first" });
    expect(archiveAvailability(row(S("a", 1, { pinned: true })))).toEqual({ type: "blocked", reason: "Unpin to archive" });
    expect(archiveAvailability(row(S("a", 1, { archived: true })))).toEqual({ type: "blocked", reason: "Already archived" });
  });
});
