import { describe, expect, it } from "vitest";
import {
  addStage, addWorker, changeLine, changesNote, freeStageId, freeWorkerName, modelChoices, modelName, parseModel, removeWorker, reshapes, routeChanges,
  setWorkerModel, undoChange,
} from "./workflowRoute";
import { PROPOSAL_STAGES } from "./fixtures/proposals";
import { MODELS } from "./fixtures/sheet";

const OPUS = "anthropic/claude-opus-4-5:high";

describe("a worker's model", () => {
  it("reads provider, id and level, and names the model from the session's list", () => {
    expect(parseModel(OPUS)).toEqual({ provider: "anthropic", id: "claude-opus-4-5", level: "high" });
    expect(parseModel("openai/gpt-5")).toEqual({ provider: "openai", id: "gpt-5", level: undefined });
    expect(parseModel("not a model")).toBeUndefined();
    expect(modelName(OPUS, MODELS)).toBe("Claude Opus 4.5");
    expect(modelName("acme/unlisted", MODELS)).toBe("unlisted");
    expect(modelName(undefined, MODELS)).toBe("its default model");
  });
});

describe("the reader's route edits", () => {
  it("keeps a model change apart from the changes the plan must follow, and starts with it", () => {
    const edited = setWorkerModel(setWorkerModel(PROPOSAL_STAGES, "api", OPUS), "page", "openai/gpt-5");
    const changes = routeChanges(PROPOSAL_STAGES, edited);
    expect(changes).toEqual([
      { kind: "model", stage: "port", worker: "api", from: "anthropic/claude-sonnet-5", to: OPUS },
      { kind: "model", stage: "port", worker: "page", from: undefined, to: "openai/gpt-5" }]);
    expect(reshapes(changes)).toEqual([]);
    expect(modelChoices(changes)).toEqual({ api: OPUS, page: "openai/gpt-5" });
    // Back to the session's model is a choice too, sent as null.
    expect(modelChoices(routeChanges(PROPOSAL_STAGES, setWorkerModel(PROPOSAL_STAGES, "api", undefined)))).toEqual({ api: null });
    expect(modelChoices([])).toBeUndefined();
  });

  it("lists added and removed stages and workers in route order, as lines for the agent", () => {
    const edited = addStage(addWorker(removeWorker(PROPOSAL_STAGES.filter((stage) => stage.id !== "shape"), "port", "page"), "review", "reviewer"), "review", "Docs");
    const changes = routeChanges(PROPOSAL_STAGES, edited);
    expect(reshapes(changes)).toHaveLength(4);
    expect(changes.map((change) => changeLine(change, edited, MODELS))).toEqual([
      "Removed stage Shape.", "Removed worker `page` from Port the API and the page.", "New worker `reviewer` (reviewer) in Review.", "New stage Docs, after Review."]);
    expect(changesNote(changes, edited)).toBe(["Change the route:", "- Removed stage Shape.", "- Removed worker `page` from Port the API and the page.",
      "- New worker `reviewer` (reviewer) in Review.", "- New stage Docs, after Review."].join("\n"));
    expect(changeLine({ kind: "model", stage: "port", worker: "api", from: undefined, to: OPUS }, edited, MODELS))
      .toBe("`api` in Port the API and the page runs on Claude Opus 4.5, not its default model.");
  });

  it("takes back one change and keeps the rest", () => {
    const edited = addStage(removeWorker(PROPOSAL_STAGES.filter((stage) => stage.id !== "shape"), "port", "api"), undefined, "Recon");
    const changes = routeChanges(PROPOSAL_STAGES, edited);
    const restored = changes.reduce((route, change) => undoChange(PROPOSAL_STAGES, route, change), edited);
    expect(restored).toEqual(PROPOSAL_STAGES);
    // The removed worker goes back to its place in the agent's order.
    const one = undoChange(PROPOSAL_STAGES, edited, changes.find((change) => change.kind === "remove-worker")!);
    expect(one.find((stage) => stage.id === "port")?.workers?.map((worker) => worker.name)).toEqual(["api", "page"]);
    expect(one.map((stage) => stage.id)).toEqual(["recon", "port", "review", "land"]);
  });

  it("names a new worker or stage so it is unique", () => {
    expect(freeWorkerName(PROPOSAL_STAGES, "reviewer")).toBe("reviewer");
    expect(freeWorkerName(PROPOSAL_STAGES, "review-bot")).toBe("review-2");
    expect(freeWorkerName(PROPOSAL_STAGES, undefined)).toBe("helper");
    expect(freeStageId(PROPOSAL_STAGES, "Review")).toBe("review-2");
    expect(freeStageId(PROPOSAL_STAGES, "!!!")).toBe("stage");
    expect(addWorker(PROPOSAL_STAGES, "review", undefined).find((stage) => stage.id === "review")?.workers?.at(-1)).toEqual({ name: "helper" });
  });
});
