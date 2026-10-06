import { describe, expect, it } from "vitest";
import type { ChatGroup } from "./chatGroups";
import type { ChatLine, ToolExecutionPart } from "./components/shared";
import { turnLedgerRows, turnRailState } from "./turnRail";

function exec(toolName: string, status: ToolExecutionPart["status"], args?: unknown, extra: Partial<ToolExecutionPart> = {}): ToolExecutionPart {
  return { type: "toolExecution", toolName, summary: "", status, ...(args === undefined ? {} : { args }), ...extra };
}

/** One rail group carrying the agent's technical parts, as `groupChatMessages` emits them. */
function work(...parts: ToolExecutionPart[]): ChatGroup {
  const message: ChatLine = { role: "assistant", parts };
  return { kind: "group", messages: [message], startIndex: 0, endIndex: 0 };
}

function prose(text: string): ChatGroup {
  return { kind: "message", message: { role: "assistant", parts: [{ type: "text", text }] }, index: 0 };
}

const repositoryPath = "/home/simonwjackson/code/sandbox/fullscreen-browser/app/src/main/kotlin/com/simonwjackson/fullscreenbrowser/ExtensionPackageRepository.kt";
const duplicateOldText = `Found 2 occurrences of edits[0] in ${repositoryPath}. Each oldText must be unique. Please provide more context to make it unique.`;

describe("turnLedgerRows", () => {
  it("derives edit count and diff stats from fields already on the execution", () => {
    const rows = turnLedgerRows([
      work(exec("edit", "success", { path: repositoryPath, edits: [{}, {}] }, {
        details: { diff: "+one\n+two\n-three\n context" },
      })),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "edit",
      label: "ExtensionPackageRepository.kt",
      outcome: "done",
      editCount: 2,
      added: 2,
      removed: 1,
    });
  });

  it("leaves rows without meaningful quantities unfilled", () => {
    const rows = turnLedgerRows([work(exec("read", "success", { path: repositoryPath }))]);

    expect(rows[0]?.editCount).toBeUndefined();
    expect(rows[0]?.added).toBe(0);
    expect(rows[0]?.removed).toBe(0);
  });

  it("labels a script step by its purpose and counts the calls it made", () => {
    const rows = turnLedgerRows([work(exec("codemode", "success", { code: "// Check the build" }, {
      summary: "Check the build",
      details: { calls: [{ name: "bash", args: "{}", status: "ok" }, { name: "read", args: "{}", status: "ok" }] },
    }))]);

    expect(rows[0]).toMatchObject({ verb: "codemode", label: "Check the build", outcome: "done", callCount: 2 });
    expect(rows[0]?.editCount).toBeUndefined();
  });

  it("takes a failed script's evidence from its script error, not Pi's run header", () => {
    const rows = turnLedgerRows([work(exec("codemode", "error", { code: "await tools.bash({ command: 'exit 1' })" }, {
      summary: "await tools.bash",
      content: [
        { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" },
        { type: "text", text: "Script error:\nError: Command exited with code 1\n\nTool calls made before the failure (they are not undone): bash (error)" },
      ],
    }))]);

    expect(rows[0]).toMatchObject({ outcome: "failed", evidence: "Error: Command exited with code 1" });
    expect(rows[0]?.callCount).toBeUndefined();
  });

  it("keeps failure evidence with the failed row", () => {
    const rows = turnLedgerRows([
      work(exec("bash", "error", { command: "npm run verify" }, { resultText: "vitest failed" })),
    ]);

    expect(rows[0]).toMatchObject({
      verb: "bash",
      label: "npm run verify",
      outcome: "failed",
      evidence: "vitest failed",
    });
  });
});

describe("turnRailState", () => {
  it("stays idle for a turn that did no work", () => {
    expect(turnRailState([prose("the answer")], false)).toEqual({ kind: "idle" });
  });

  it("reports the same aggregate information while the turn is working", () => {
    const state = turnRailState([
      work(exec("edit", "success", { path: repositoryPath }, { details: { diff: "+added one\n+added two\n-removed one\n context" } })),
      work(exec("read", "running", { path: "/repo/app/src/" })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.current?.verb).toBe("read");
    expect(state.current?.label).toBe("src/");
    expect(state.stepCount).toBe(2);
    expect(state.fileCount).toBe(2);
    expect(state.added).toBe(2);
    expect(state.removed).toBe(1);
    expect(state.pins).toEqual([]);
  });

  it("pins a failed step while the turn keeps working", () => {
    const state = turnRailState([
      work(exec("edit", "error", { path: repositoryPath, edits: [1, 2] }, { resultText: duplicateOldText })),
      work(exec("read", "running", { path: "/home/simonwjackson/code/sandbox/fullscreen-browser/app/src/" })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.pins).toHaveLength(1);
    expect(state.pins[0]?.verb).toBe("edit");
    expect(state.pins[0]?.label).toBe("ExtensionPackageRepository.kt");
    expect(state.pins[0]?.evidence).toBe("Found 2 occurrences of edits[0].");
    expect(state.current?.verb).toBe("read");
  });

  it("clears a pin when the same verb succeeds on the same target", () => {
    const state = turnRailState([
      work(exec("edit", "error", { path: repositoryPath }, { resultText: duplicateOldText })),
      work(exec("edit", "success", { path: repositoryPath })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.pins).toEqual([]);
    expect(state.retries).toBe(1);
  });

  it("keeps the pin when a different verb succeeds on the same target", () => {
    const state = turnRailState([
      work(exec("edit", "error", { path: repositoryPath }, { resultText: duplicateOldText })),
      work(exec("read", "success", { path: repositoryPath })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.pins).toHaveLength(1);
    expect(state.retries).toBe(0);
  });

  it("keeps the pin when the same verb succeeds on a different target", () => {
    const state = turnRailState([
      work(exec("bash", "error", { command: "npm run verify" }, { resultText: "vitest failed" })),
      work(exec("bash", "success", { command: "npm run verify -- --run" })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.pins).toHaveLength(1);
    expect(state.pins[0]?.label).toBe("npm run verify");
  });

  it("keeps concurrent pins in the order they failed", () => {
    const state = turnRailState([
      work(exec("edit", "error", { path: repositoryPath }, { resultText: duplicateOldText })),
      work(exec("bash", "error", { command: "npm run verify" }, { resultText: "vitest failed" })),
      work(exec("edit", "running", { path: repositoryPath })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.pins.map((pin) => pin.verb)).toEqual(["edit", "bash"]);
  });

  it("settles into a receipt with step, file and diff counts", () => {
    const state = turnRailState([
      work(exec("read", "success", { path: "/repo/app/src/" })),
      work(exec("edit", "success", { path: repositoryPath }, { details: { diff: "+added one\n+added two\n-removed one\n context" } })),
    ], false);

    expect(state).toEqual({
      kind: "settled",
      outcome: "done",
      stepCount: 2,
      fileCount: 2,
      added: 2,
      removed: 1,
      retries: 0,
      unresolved: [],
    });
  });

  it("settles failed when a pin never cleared, naming what stayed broken", () => {
    const state = turnRailState([
      work(exec("edit", "error", { path: repositoryPath }, { resultText: duplicateOldText })),
      work(exec("edit", "success", { path: repositoryPath })),
      work(exec("bash", "error", { command: "npm run verify" }, { resultText: "vitest failed" })),
    ], false);

    expect(state.kind).toBe("settled");
    if (state.kind !== "settled") return;
    expect(state.outcome).toBe("failed");
    expect(state.retries).toBe(1);
    expect(state.unresolved.map((pin) => pin.label)).toEqual(["npm run verify"]);
  });

  it("counts distinct files rather than file steps", () => {
    const state = turnRailState([
      work(exec("read", "success", { path: repositoryPath })),
      work(exec("edit", "success", { path: repositoryPath })),
      work(exec("edit", "success", { path: repositoryPath })),
    ], false);

    expect(state.kind).toBe("settled");
    if (state.kind !== "settled") return;
    expect(state.fileCount).toBe(1);
    expect(state.stepCount).toBe(3);
  });

  it("labels a subagent by its agent name and a process by its process name", () => {
    const state = turnRailState([
      work(exec("subagent", "success", { agent: "se-code-review" })),
      work(exec("process", "running", { name: "dev" })),
    ], true);

    expect(state.kind).toBe("working");
    if (state.kind !== "working") return;
    expect(state.current?.label).toBe("dev");
  });
});
