import { describe, expect, it } from "vitest";
import type { ManagedProcessInfo } from "@shared/apiTypes";
import { processMeta, processStatus, processTone } from "./processRow";

const NOW = 10 * 3_600_000;
const base: ManagedProcessInfo = { id: "p", name: "vite-dev", pid: 48211, command: "npm run dev", cwd: "/ui", startTime: NOW - 14 * 60_000, endTime: null,
  status: "running", exitCode: null, success: null, endReason: null, signal: null, errorMessage: null };
const ended = (patch: Partial<ManagedProcessInfo>): ManagedProcessInfo => ({ ...base, status: "exited", endTime: NOW - 3 * 60_000, ...patch });

describe("a process row", () => {
  it("names a failed exit code, and keeps the plain word for the rest", () => {
    expect(processStatus(ended({ exitCode: 2, success: false, endReason: "exit" }))).toBe("Exited with 2");
    expect(processStatus(ended({ exitCode: 0, success: true, endReason: "exit" }))).toBe("Exited");
    expect(processStatus(ended({ endReason: "lost" }))).toBe("Lost");
    expect(processStatus(base)).toBe("Running");
  });

  it("gives each end its tone", () => {
    expect(processTone(base)).toBe("working");
    expect(processTone(ended({ exitCode: 0, success: true, endReason: "exit" }))).toBe("quiet");
    expect(processTone(ended({ exitCode: 2, success: false, endReason: "exit" }))).toBe("failed");
    expect(processTone(ended({ endReason: "spawn_error" }))).toBe("failed");
    expect(processTone(ended({ endReason: "lost" }))).toBe("retrying");
    expect(processTone({ ...base, status: "terminate_timeout" })).toBe("retrying");
    expect(processTone(ended({ status: "killed", endReason: "signal" }))).toBe("stopped");
  });

  it("reads the pid and uptime while it runs, and the age of its end after", () => {
    expect(processMeta(base, NOW)).toBe("pid 48211, up 14m");
    expect(processMeta({ ...base, pid: 0 }, NOW)).toBe("up 14m");
    expect(processMeta(ended({}), NOW)).toBe("ended 3m ago");
  });
});
