import { describe, expect, it } from "vitest";
import { activeRun, launchInputs, routeSteps, runStatus, stopIsOpen, stopOutcome, stripSegments, waitingStops, workflowEntryOf, type WorkflowRun } from "./workflowsModel";
import { BUILDING, CHILD_LOOKS, CONTRACT_STOP, CONTRACT_WAITING, FAILED, LAND_STOP, LAND_WAITING, LANDED, SAVED, STAGES } from "./fixtures/runs";

const RUN_ID = "a".repeat(64);
describe("workflow transcript entries", () => {
  it("reads a launch, a decision, and a stop card, and leaves other messages alone", () => {
    expect(workflowEntryOf({ role: "user", content: `Workflow run ${RUN_ID}\n\nAgree a contract.\n\nWorkflow inputs (JSON):\n{}` }))
      .toEqual({ kind: "started", runId: RUN_ID, text: "Agree a contract.\n\nWorkflow inputs (JSON):\n{}" });
    expect(workflowEntryOf({ role: "user", content: '[workflow design-build-review] The user approved "Contract".\nContinue with the next stage.' }))
      .toEqual({ kind: "decided", workflow: "design-build-review", text: 'The user approved "Contract".' });
    expect(workflowEntryOf({ role: "custom", customType: "forgerie.workflow-stop", content: "",
      details: { runId: RUN_ID, stage: "land", stageName: "Land", stop: "land", summary: "Ready.", workflow: "dbr", round: 2 } }))
      .toEqual({ kind: "stop", runId: RUN_ID, stage: "land", stageName: "Land", stop: "land", summary: "Ready.", workflow: "dbr", round: 2 });
    expect(workflowEntryOf({ role: "user", content: "Workflow run is a phrase I typed" })).toBeUndefined();
    expect(workflowEntryOf({ role: "user", content: "[subagent api answered, no reply needed] Done." })).toBeUndefined();
  });
});

describe("a stop card", () => {
  it("is open only for the round the run waits on", () => {
    expect(stopIsOpen(CONTRACT_WAITING, CONTRACT_STOP)).toBe(true);
    expect(stopIsOpen(CONTRACT_WAITING, { ...CONTRACT_STOP, round: 1 })).toBe(false);
    expect(stopIsOpen(BUILDING, CONTRACT_STOP)).toBe(false);
    expect(stopIsOpen(undefined, CONTRACT_STOP)).toBe(false);
  });

  it("says what the reader decided", () => {
    expect(stopOutcome(BUILDING, CONTRACT_STOP)).toBe("Approved by you.");
    expect(stopOutcome(LANDED, LAND_STOP)).toBe("Landed feat/run-export-api, design/run-export.");
    const changed: WorkflowRun = { ...CONTRACT_WAITING, stops: { contract: { state: "open", note: "Name the columns.", round: 1 } } };
    expect(stopOutcome(changed, CONTRACT_STOP)).toBe("You asked for changes: Name the columns.");
    // The agent asked again: the first card keeps the decision without its note.
    const again: WorkflowRun = { ...CONTRACT_WAITING, stops: { contract: { state: "waiting", round: 1 } } };
    expect(stopOutcome(again, CONTRACT_STOP)).toBe("You asked for changes.");
    expect(stopOutcome(undefined, CONTRACT_STOP)).toContain("no longer");
  });
});

describe("a run at a glance", () => {
  it("names where the run stands", () => {
    expect(runStatus(CONTRACT_WAITING)).toBe("Contract, waiting for you");
    expect(runStatus(BUILDING)).toBe("Design and build, 2 working");
    expect(runStatus(LAND_WAITING)).toBe("Land, waiting for you");
    expect(runStatus(LANDED)).toBe("Finished");
    expect(waitingStops(LAND_WAITING)).toBe(1);
    expect(waitingStops(LANDED)).toBe(0);
    expect(activeRun([LANDED, BUILDING])).toBe(BUILDING);
  });

  it("draws parallel workers as lanes and a finished run as done", () => {
    expect(stripSegments(BUILDING)).toEqual([
      { key: "contract", lanes: ["done"] }, { key: "build", lanes: ["working", "working"] }, { key: "review", lanes: ["next"] }, { key: "land", lanes: ["next"] }]);
    expect(stripSegments(LANDED).flatMap((segment) => segment.lanes)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("marks a failed parallel worker without changing the other lanes", () => {
    expect(stripSegments(FAILED)).toEqual([
      { key: "contract", lanes: ["done"] }, { key: "build", lanes: ["done", "failed"] }, { key: "review", lanes: ["next"] }, { key: "land", lanes: ["next"] }]);
    expect(stripSegments({ ...FAILED, state: { kind: "running" } })[1]?.lanes).toEqual(["done", "failed"]);
  });

  it.each([{ workers: [] }, { workers: [{ name: "review" }] }])("marks a failed single-lane stage with workers $workers", ({ workers }) => {
    const run: WorkflowRun = { ...FAILED, stages: STAGES.map((stage) => stage.id === "review" ? { ...stage, workers } : stage),
      children: [...FAILED.children,
        { conversationId: 33, reporterId: 9, name: "review", stage: "review", state: { kind: "settled", outcome: "failed", result: "Review failed.", delivered: true } }] };
    expect(stripSegments(run)[2]?.lanes).toEqual(["failed"]);
  });

  it.each(["build", "review"])("shows done when the latest %s child answered after a failure", (stage) => {
    const run: WorkflowRun = { ...LAND_WAITING, children: [...LAND_WAITING.children,
      { conversationId: 40, reporterId: 10, name: stage, stage, state: { kind: "settled", outcome: "failed", result: "Failed.", delivered: true } },
      { conversationId: 41, reporterId: 11, name: stage, stage, state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } }] };
    expect(stripSegments(run).find((segment) => segment.key === stage)?.lanes).toEqual(stage === "build" ? ["done", "done"] : ["done"]);
  });

  it.each(["build", "review"])("shows working when the latest %s child is retrying after a failure", (stage) => {
    const run: WorkflowRun = { ...LAND_WAITING, children: [...LAND_WAITING.children,
      { conversationId: 40, reporterId: 10, name: stage, stage, state: { kind: "settled", outcome: "failed", result: "Failed.", delivered: true } },
      { conversationId: 41, reporterId: 11, name: stage, stage, state: { kind: "working" } }] };
    expect(stripSegments(run).find((segment) => segment.key === stage)?.lanes).toEqual(stage === "build" ? ["done", "working"] : ["working"]);
  });

  it("uses the latest parallel child even when an older child is still working", () => {
    const run: WorkflowRun = { ...BUILDING, children: [...BUILDING.children,
      { conversationId: 40, reporterId: 10, name: "build", stage: "build", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } }] };
    expect(stripSegments(run)[1]?.lanes).toEqual(["working", "done"]);
  });

  it("keeps a single-lane stage working while another child is still working", () => {
    const run: WorkflowRun = { ...BUILDING, children: [...BUILDING.children,
      { conversationId: 33, reporterId: 9, name: "review", stage: "review", state: { kind: "working" } },
      { conversationId: 40, reporterId: 10, name: "review", stage: "review", state: { kind: "settled", outcome: "failed", result: "Failed.", delivered: true } }] };
    expect(stripSegments(run)[2]?.lanes).toEqual(["working"]);
  });

  it("keeps the current lane rules when no child has started", () => {
    expect(stripSegments(CONTRACT_WAITING)).toEqual([
      { key: "contract", lanes: ["waiting"] }, { key: "build", lanes: ["next", "next"] }, { key: "review", lanes: ["next"] }, { key: "land", lanes: ["next"] }]);
    expect(stripSegments({ ...BUILDING, children: [] })[1]?.lanes).toEqual(["next", "next"]);
    expect(stripSegments({ ...LANDED, children: [] }).flatMap((segment) => segment.lanes)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("puts declared workers on the route before they start, and opens only started ones", () => {
    const planned = routeSteps(STAGES, undefined);
    expect(planned.map((step) => [step.key, step.state, step.mine === true])).toEqual([
      ["contract", "next", true], ["build", "next", false], ["review", "next", false], ["land", "next", true]]);
    expect(planned[1]?.tracks?.map((track) => [track.name, track.lines])).toEqual([
      ["design", ["design-engineer", "anthropic/claude-opus-5.5"]], ["build", ["full-stack-engineer"]]]);
    const opened: string[] = [];
    const live = routeSteps(STAGES, BUILDING, CHILD_LOOKS, (name) => opened.push(name));
    expect(live[0]).toMatchObject({ state: "done", word: "Approved by you" });
    expect(live[1]?.tracks?.map((track) => [track.state, track.lines?.at(-1)])).toEqual([["working", "design/run-export"], ["working", "feat/run-export-api"]]);
    live[1]?.tracks?.[0]?.onPress?.();
    expect(opened).toEqual(["design"]);
    expect(live[2]?.tracks?.[0]?.onPress).toBeUndefined();
  });
});

describe("launch inputs", () => {
  it("fills defaults, converts declared types, and names what is missing", () => {
    const workflow = SAVED[0]!;
    expect(launchInputs(workflow, { task: " " })).toEqual({ problem: "Fill in task." });
    expect(launchInputs(workflow, { task: "Export" })).toEqual({ inputs: { task: "Export" } });
    const typed = { ...workflow, definition: { version: 1 as const, inputs: { rounds: { type: "number" as const, default: 2 }, review: { type: "boolean" as const } } } };
    expect(launchInputs(typed, { rounds: "", review: "false" })).toEqual({ inputs: { review: false } });
    expect(launchInputs(typed, { rounds: "two", review: "true" })).toEqual({ problem: "rounds must be a number." });
  });
});
