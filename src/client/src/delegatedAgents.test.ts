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

  it("prefers live progress over results while a run is in flight", () => {
    const runs = deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-eb2ca573",
        toolName: "subagent",
        summary: "subagent parallel (3)",
        status: "running",
        args: { tasks: [{ agent: "se-architecture-strategist" }] },
        details: {
          mode: "parallel",
          runId: "eb2ca573",
          results: [],
          progress: [
            progress(0, "se-architecture-strategist", "running", { currentTool: "grep", currentToolArgs: "src/main/kotlin", durationMs: 240_000 }),
            progress(1, "se-maintainability-reviewer", "completed", { durationMs: 360_000 }),
            progress(2, "se-project-standards-reviewer", "failed", { error: "model not supported" }),
          ],
        },
      }),
    ]);

    expect(runs[0]).toMatchObject({ id: "eb2ca573", live: true, state: "running" });
    expect(runs[0]?.counts).toEqual({ total: 3, running: 1, done: 1, failed: 1 });
    expect(runs[0]?.agents[0]).toMatchObject({
      name: "se-architecture-strategist",
      state: "running",
      detail: "grep src/main/kotlin",
      elapsedMs: 240_000,
    });
    expect(runs[0]?.agents[2]).toMatchObject({ state: "failed", detail: "model not supported" });
  });

  it("falls back to the call arguments before any agent has reported", () => {
    const runs = deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-pending",
        toolName: "subagent",
        summary: "subagent parallel (2)",
        status: "pending",
        args: { tasks: [{ agent: "scout", task: "map the flow" }, { agent: "reviewer" }] },
      }),
    ]);

    // No runId is available yet, so the tool call id identifies the run.
    expect(runs[0]).toMatchObject({ id: "call-pending", live: true, label: "2 agents" });
    expect(runs[0]?.agents.map((agent) => agent.state)).toEqual(["pending", "pending"]);
    expect(runs[0]?.agents[0]).toMatchObject({ name: "scout", task: "map the flow" });
  });

  it("expands a repeated parallel task into one agent per copy", () => {
    const runs = deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-count",
        toolName: "subagent",
        summary: "subagent parallel (3)",
        status: "running",
        args: { tasks: [{ agent: "scout", count: 3 }] },
      }),
    ]);

    expect(runs[0]?.agents).toHaveLength(3);
    expect(runs[0]?.label).toBe("scout ×3");
  });

  it("flattens a chain, including its parallel groups", () => {
    const runs = deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-chain",
        toolName: "subagent",
        summary: "subagent chain (3)",
        status: "running",
        args: { chain: [{ agent: "scout" }, { parallel: [{ agent: "reviewer" }, { agent: "reviewer" }] }] },
      }),
    ]);

    expect(runs[0]?.agents.map((agent) => agent.name)).toEqual(["scout", "reviewer", "reviewer"]);
  });

  it("survives details it cannot read, keeping the run visible", () => {
    const shapes: unknown[] = [undefined, null, "boom", {}, { results: "not-an-array" }, []];

    for (const details of shapes) {
      const runs = deriveDelegatedRuns([
        assistantLine({
          type: "toolExecution",
          toolCallId: "call-odd",
          toolName: "subagent",
          summary: "subagent single",
          status: "running",
          args: { agent: "worker", task: "do the thing" },
          details,
        }),
      ]);

      expect(runs).toHaveLength(1);
      expect(runs[0]?.agents.map((agent) => agent.name)).toEqual(["worker"]);
    }
  });

  it("drops a call that names no agents at all", () => {
    expect(deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-empty",
        toolName: "subagent",
        summary: "subagent",
        status: "running",
        args: {},
      }),
    ])).toEqual([]);
  });

  it("keeps async and detached provenance for a later iteration to surface", () => {
    const runs = deriveDelegatedRuns([
      assistantLine({
        type: "toolExecution",
        toolCallId: "call-async",
        toolName: "subagent",
        summary: "subagent single [async]",
        status: "success",
        args: { agent: "worker", async: true },
        details: {
          mode: "single",
          runId: "1cda7fe6",
          asyncId: "1cda7fe6",
          context: "fresh",
          results: [{ agent: "worker", exitCode: 0, output: "done", detached: true }],
        },
      }),
    ]);

    expect(runs[0]).toMatchObject({ asyncId: "1cda7fe6", context: "fresh" });
    expect(runs[0]?.agents[0]?.state).toBe("detached");
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

function progress(
  index: number,
  agent: string,
  status: string,
  extra: { currentTool?: string; currentToolArgs?: string; durationMs?: number; error?: string } = {},
) {
  return { index, agent, status, task: `task for ${agent}`, recentTools: [], toolCount: 0, tokens: 0, durationMs: 0, ...extra };
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
