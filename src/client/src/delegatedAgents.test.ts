import { describe, expect, it } from "vitest";
import type { ChatLine, ToolExecutionPart } from "./components/shared";
import { deriveDelegatedRuns } from "./delegatedAgents";

describe("deriveDelegatedRuns", () => {
  it("derives one run per completed subagent call, with its agents", () => {
    const runs = deriveDelegatedRuns([
      assistantLine(finishedRun("f8166139", [
        result("se-correctness-reviewer", 0, "3 P2 findings"),
        result("se-testing-reviewer", 0, "no findings"),
      ])),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: "f8166139", state: "done", live: false });
    expect(runs[0]?.agents.map((agent) => agent.name)).toEqual([
      "se-correctness-reviewer",
      "se-testing-reviewer",
    ]);
    expect(runs[0]?.agents.map((agent) => agent.state)).toEqual(["done", "done"]);
  });

  it("labels a run by its agent name only when every child shares one", () => {
    const shared = deriveDelegatedRuns([
      assistantLine(finishedRun("6f167d8f", [
        result("scout", 0, ""),
        result("scout", 0, ""),
        result("scout", 0, ""),
      ])),
    ]);
    const mixed = deriveDelegatedRuns([
      assistantLine(finishedRun("eb2ca573", [
        result("se-architecture-strategist", 0, ""),
        result("se-learnings-researcher", 0, ""),
        result("se-performance-reviewer", 0, ""),
      ])),
    ]);

    expect(shared[0]?.label).toBe("scout ×3");
    // eb2ca573 really did mix reviewers, a researcher and a strategist:
    // a name-substring rule would have called it "reviewers ×3" and been wrong.
    expect(mixed[0]?.label).toBe("3 agents");
  });

  it("labels a single-agent run with the bare agent name", () => {
    const runs = deriveDelegatedRuns([
      assistantLine(finishedRun("128127a5", [result("worker", 0, "done")])),
    ]);

    expect(runs[0]?.label).toBe("worker");
  });

  it("marks a non-zero exit as failed and carries its error as the detail", () => {
    const runs = deriveDelegatedRuns([
      assistantLine(finishedRun("f011359d", [
        result("se-project-standards-reviewer", 1, "", "model not supported"),
      ])),
    ]);

    expect(runs[0]).toMatchObject({ state: "failed" });
    expect(runs[0]?.agents[0]).toMatchObject({
      state: "failed",
      detail: "model not supported",
    });
  });

  it("reports a partially failed run with per-state counts", () => {
    const runs = deriveDelegatedRuns([
      assistantLine(finishedRun("eb2ca573", [
        result("a", 0, "ok"),
        result("b", 0, "ok"),
        result("c", 1, "", "model not supported"),
      ])),
    ]);

    expect(runs[0]?.state).toBe("partial");
    expect(runs[0]?.counts).toEqual({ total: 3, running: 0, done: 2, failed: 1 });
  });

  it("returns the newest run first across messages", () => {
    const runs = deriveDelegatedRuns([
      assistantLine(finishedRun("older", [result("scout", 0, "")])),
      assistantLine(finishedRun("newer", [result("scout", 0, "")])),
    ]);

    expect(runs.map((run) => run.id)).toEqual(["newer", "older"]);
  });

  it("ignores tool calls that are not subagent runs", () => {
    const readPart: ToolExecutionPart = {
      type: "toolExecution",
      toolCallId: "call-read",
      toolName: "read",
      summary: "read plan.md",
      status: "success",
    };

    expect(deriveDelegatedRuns([assistantLine(readPart)])).toEqual([]);
  });

  it("ignores subagent management calls, which run no agents", () => {
    const managementPart: ToolExecutionPart = {
      type: "toolExecution",
      toolCallId: "call-list",
      toolName: "subagent",
      summary: "subagent list",
      status: "success",
      args: { action: "list" },
      details: { mode: "management", results: [] },
    };

    expect(deriveDelegatedRuns([assistantLine(managementPart)])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixtures — shaped after real 9 Aug hiper runs.
// ---------------------------------------------------------------------------

function assistantLine(...parts: ToolExecutionPart[]): ChatLine {
  return { role: "assistant", parts };
}

function result(agent: string, exitCode: number, output: string, error?: string) {
  return { agent, task: `task for ${agent}`, exitCode, output, ...(error === undefined ? {} : { error }) };
}

function finishedRun(runId: string, results: ReturnType<typeof result>[]): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: `call-${runId}`,
    toolName: "subagent",
    summary: `subagent parallel (${String(results.length)})`,
    status: "success",
    args: { tasks: results.map((entry) => ({ agent: entry.agent, task: entry.task })) },
    details: { mode: "parallel", runId, context: "fork", results },
  };
}
