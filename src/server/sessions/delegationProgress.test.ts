import { describe, expect, it } from "vitest";
import { launchedAgentCount, runningAgentCount, spawnedSessionFiles } from "./delegationProgress";

/**
 * Shaped after the events Pi actually emits: `tool_execution_update` carries
 * the in-flight payload as `partialResult`, `tool_execution_end` as `result`.
 * An earlier version read `details ?? result` and so counted nothing for an
 * entire run.
 */
function updateEvent(progress: unknown): Record<string, unknown> {
  return {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "subagent",
    partialResult: { details: { mode: "parallel", runId: "eb2ca573", results: [], progress } },
  };
}

describe("runningAgentCount", () => {
  it("counts the agents a run reports as working", () => {
    expect(runningAgentCount(updateEvent([
      { index: 0, agent: "scout", status: "running" },
      { index: 1, agent: "scout", status: "completed" },
      { index: 2, agent: "scout", status: "running" },
    ]))).toBe(2);
  });

  it("reports zero once every agent has finished", () => {
    expect(runningAgentCount(updateEvent([
      { index: 0, agent: "scout", status: "completed" },
      { index: 1, agent: "scout", status: "failed" },
    ]))).toBe(0);
  });

  it("reads the finished payload too, which arrives under result", () => {
    expect(runningAgentCount({
      type: "tool_execution_end",
      result: { details: { progress: [{ index: 0, agent: "scout", status: "running" }] } },
    })).toBe(1);
  });

  it("accepts a payload that is already the details object", () => {
    expect(runningAgentCount({ partialResult: { progress: [{ status: "running" }] } })).toBe(1);
  });

  it("says nothing when the tool reports no progress, so a count is left alone", () => {
    expect(runningAgentCount(updateEvent(undefined))).toBeUndefined();
    expect(runningAgentCount({ type: "tool_execution_update" })).toBeUndefined();
    expect(runningAgentCount(undefined)).toBeUndefined();
    expect(runningAgentCount("nonsense")).toBeUndefined();
  });
});

describe("spawnedSessionFiles", () => {
  it("collects every session a result says it made", () => {
    expect(spawnedSessionFiles({
      result: {
        details: {
          results: [
            { agent: "scout", sessionFile: "/s/a.jsonl" },
            { agent: "scout", sessionFile: "/s/b.jsonl" },
            { agent: "scout" },
          ],
        },
      },
    })).toEqual(["/s/a.jsonl", "/s/b.jsonl"]);
  });

  it("returns nothing for a result that made no sessions", () => {
    expect(spawnedSessionFiles({ result: { details: { results: [] } } })).toEqual([]);
    expect(spawnedSessionFiles({ result: {} })).toEqual([]);
    expect(spawnedSessionFiles(undefined)).toEqual([]);
  });
});

describe("launchedAgentCount", () => {
  it("counts one agent for a single delegation", () => {
    expect(launchedAgentCount({ agent: "scout", task: "map the module" })).toBe(1);
  });

  it("counts every task in a parallel fan-out", () => {
    expect(launchedAgentCount({ tasks: [{ agent: "a" }, { agent: "b" }, { agent: "c" }] })).toBe(3);
  });

  it("honours a repeated task's count", () => {
    expect(launchedAgentCount({ tasks: [{ agent: "a", count: 4 }, { agent: "b" }] })).toBe(5);
  });

  it("counts a chain as one, because its steps run one after another", () => {
    expect(launchedAgentCount({ chain: [{ agent: "a" }, { agent: "b" }, { agent: "c" }] })).toBe(1);
  });

  it("counts nothing for a call that launches no agents", () => {
    expect(launchedAgentCount({ action: "list" })).toBe(0);
    expect(launchedAgentCount({ tasks: [] })).toBe(0);
    expect(launchedAgentCount({ chain: [] })).toBe(0);
    expect(launchedAgentCount(undefined)).toBe(0);
    expect(launchedAgentCount("nonsense")).toBe(0);
  });

  it("ignores a nonsense count rather than trusting it", () => {
    expect(launchedAgentCount({ tasks: [{ agent: "a", count: -2 }, { agent: "b", count: 1.7 }] })).toBe(2);
  });
});
