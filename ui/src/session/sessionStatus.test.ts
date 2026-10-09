import { describe, expect, test } from "vitest";
import { sessionStatus, type StatusFacts } from "./sessionStatus";

const idle: StatusFacts = { connection: "ready", dialogOpen: false, askOpen: false, sending: false, compaction: "idle", running: false, shellRunning: false, problems: 0 };

describe("sessionStatus", () => {
  test("a healthy idle session is quiet and has nothing to open", () => {
    expect(sessionStatus(idle)).toEqual({ label: "Connected", tone: "quiet", count: 0, countLabel: undefined, hasDetail: false });
  });

  test("problems in an idle session name the chip", () => {
    expect(sessionStatus({ ...idle, problems: 1 })).toMatchObject({ label: "Problem", tone: "bad", count: 0, hasDetail: true });
    expect(sessionStatus({ ...idle, problems: 3 })).toMatchObject({ label: "3 problems", tone: "bad", count: 0 });
  });

  test("activity keeps its word, and problems ride along as a count", () => {
    expect(sessionStatus({ ...idle, running: true, problems: 2 }))
      .toEqual({ label: "Running", tone: "live", count: 2, countLabel: "2 problems", hasDetail: true });
    expect(sessionStatus({ ...idle, running: true })).toMatchObject({ label: "Running", count: 0, hasDetail: false });
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
});
