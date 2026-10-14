import { describe, expect, test } from "vitest";
import { sessionStatus, type StatusFacts } from "./sessionStatus";

const idle: StatusFacts = { connection: "ready", dialogOpen: false, askOpen: false, sending: false, compaction: "idle", running: false, shellRunning: false, problems: 0 };

describe("sessionStatus", () => {
  test("a healthy idle session is quiet and has nothing to open", () => {
    expect(sessionStatus(idle)).toEqual({ label: "Connected", tone: "quiet", count: 0, countLabel: undefined, aside: undefined, asideLabel: undefined, hasDetail: false });
  });

  test("problems in an idle session name the chip", () => {
    expect(sessionStatus({ ...idle, problems: 1 })).toMatchObject({ label: "Problem", tone: "bad", count: 0, hasDetail: true });
    expect(sessionStatus({ ...idle, problems: 3 })).toMatchObject({ label: "3 problems", tone: "bad", count: 0 });
  });

  test("activity keeps its word, and problems ride along as a count", () => {
    expect(sessionStatus({ ...idle, running: true, problems: 2 }))
      .toEqual({ label: "Running", tone: "live", count: 2, countLabel: "2 problems", aside: undefined, asideLabel: undefined, hasDetail: true });
    expect(sessionStatus({ ...idle, running: true, tasks: "unsupported" })).toMatchObject({ label: "Running", count: 0, hasDetail: false });
  });

  test("connection trouble outranks activity and always has detail", () => {
    expect(sessionStatus({ ...idle, connection: "reconnecting", running: true }))
      .toMatchObject({ label: "Reconnecting", tone: "warn", count: 0, hasDetail: true });
    expect(sessionStatus({ ...idle, connection: "failed", problems: 1 }))
      .toMatchObject({ label: "Disconnected", tone: "bad", count: 1, countLabel: "1 problem", hasDetail: true });
  });

  test("a read-only session says so before anything else", () => {
    expect(sessionStatus({ ...idle, readOnly: "Landed", connection: "failed" })).toMatchObject({ label: "Landed", tone: "neutral", hasDetail: false });
  });

  test("activity follows the order a reader needs", () => {
    expect(sessionStatus({ ...idle, dialogOpen: true, running: true }).label).toBe("Waiting for you");
    expect(sessionStatus({ ...idle, askOpen: true, running: true }).label).toBe("Running");
    expect(sessionStatus({ ...idle, askOpen: true }).label).toBe("Waiting for you");
    expect(sessionStatus({ ...idle, sending: true, running: true }).label).toBe("Sending");
    expect(sessionStatus({ ...idle, compaction: "running", running: true }).label).toBe("Compacting");
    expect(sessionStatus({ ...idle, compaction: "queued", running: true }).label).toBe("Compaction queued");
    expect(sessionStatus({ ...idle, shellRunning: true }).label).toBe("Running shell command");
    expect(sessionStatus({ ...idle, connection: "loading" }).label).toBe("Connecting");
  });
  test("a running session opens its panel to show its tasks, even before the first read", () => {
    expect(sessionStatus({ ...idle, running: true })).toMatchObject({ label: "Running", hasDetail: true });
    expect(sessionStatus({ ...idle, running: true, tasks: { live: 0, backgroundAgents: 0 } })).toMatchObject({ hasDetail: true });
  });

  test("an idle session opens its panel only while tasks are live", () => {
    expect(sessionStatus({ ...idle, tasks: { live: 0, backgroundAgents: 0 } })).toMatchObject({ label: "Connected", tone: "quiet", hasDetail: false });
    expect(sessionStatus({ ...idle, tasks: { live: 3, backgroundAgents: 1 } }))
      .toEqual({ label: "Connected", tone: "quiet", count: 0, countLabel: undefined, aside: "1 agent", asideLabel: "1 background agent", hasDetail: true });
  });

  test("background agents ride along as a quiet aside beside any word, never the problem count", () => {
    expect(sessionStatus({ ...idle, running: true, problems: 1, tasks: { live: 5, backgroundAgents: 2 } }))
      .toMatchObject({ label: "Running", tone: "live", aside: "2 agents", asideLabel: "2 background agents", count: 1, countLabel: "1 problem" });
    expect(sessionStatus({ ...idle, problems: 2, tasks: { live: 2, backgroundAgents: 1 } }))
      .toMatchObject({ label: "2 problems", tone: "bad", aside: "1 agent", count: 0, hasDetail: true });
    expect(sessionStatus({ ...idle, connection: "reconnecting", tasks: { live: 2, backgroundAgents: 1 } })).toMatchObject({ label: "Reconnecting", aside: "1 agent" });
  });

  test("a session that is not Durable has no aside and no task panel", () => {
    expect(sessionStatus({ ...idle, running: true, tasks: "unsupported" })).toMatchObject({ aside: undefined, hasDetail: false });
  });

  test("a read-only session shows no tasks, only its problems", () => {
    expect(sessionStatus({ ...idle, readOnly: "Landed", tasks: { live: 2, backgroundAgents: 1 } })).toMatchObject({ aside: undefined, hasDetail: false });
    expect(sessionStatus({ ...idle, readOnly: "Landed", problems: 1 })).toMatchObject({ hasDetail: true });
  });
});
