import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentDirPromptLibrary } from "./promptLibrary.js";
import { assertProseOnly, parseWorkflow, workflowInputs, WorkflowLibrary, workflowPrompt } from "./workflowLibrary.js";

const definition = `---
description: An experiment
workflow:
  version: 1
  inputs:
    task:
      type: string
    review:
      type: boolean
      default: false
    rounds:
      type: number
      choices: [1, 2]
      default: 1
---
Work from the supplied task. Choose the sequence yourself.
`;
let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "forgerie-workflow-library-")); });
afterEach(async () => { await rm(root, { force: true, recursive: true }); });

describe("prose workflows in the prompt library", () => {
  it("saves, discovers, reads exact bytes, and supports project precedence", async () => {
    const profile = join(root, "agent");
    const authoring = new AgentDirPromptLibrary(profile);
    expect(await authoring.save({ name: "experiment", body: definition })).toMatchObject({ kind: "saved" });
    const library = new WorkflowLibrary(profile);
    const first = await library.read(root, "experiment");
    expect(first.text).toBe(definition);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect((await library.list(root)).workflows).toEqual([first]);
    await mkdir(join(root, ".pi", "prompts"), { recursive: true });
    await writeFile(join(root, ".pi", "prompts", "experiment.md"), definition.replace("Choose the sequence", "Review the sequence"));
    expect((await library.read(root, "experiment")).path).toContain(".pi/prompts");
    expect((await library.list(root)).workflows).toHaveLength(1);
  });

  it("keeps broken project overrides visible and never falls back to a profile definition", async () => {
    const profile = join(root, "agent");
    await new AgentDirPromptLibrary(profile).save({ name: "experiment", body: definition });
    await mkdir(join(root, ".pi", "prompts"), { recursive: true });
    await writeFile(join(root, ".pi", "prompts", "experiment.md"), "---\nworkflow: {version: 99}\n---\ninvalid");
    const inventory = await new WorkflowLibrary(profile).list(root);
    expect(inventory.workflows).toEqual([]);
    expect(inventory.diagnostics).toHaveLength(1);
    await expect(new WorkflowLibrary(profile).read(root, "experiment")).rejects.toThrow("version: 1");
    await expect(new WorkflowLibrary(profile).read(root, "../escape")).rejects.toThrow("Invalid workflow name");
  });

  it("validates required inputs, types, choices, defaults, and extra fields without coercion", () => {
    const workflow = parseWorkflow("experiment", "experiment.md", definition);
    expect(workflowInputs(workflow.definition, { task: "Build" })).toEqual({ task: "Build", review: false, rounds: 1 });
    for (const supplied of [{}, { task: "Build", review: "false" }, { task: "Build", rounds: 3 }, { task: "Build", other: true }]) {
      expect(() => workflowInputs(workflow.definition, supplied)).toThrow();
    }
    expect(() => parseWorkflow("x", "x.md", definition.replace("default: false", "default: nope"))).toThrow("default");
    expect(() => parseWorkflow("x", "x.md", definition.replace("choices: [1, 2]", "choices: [1, nope]"))).toThrow("choices");
    expect(() => parseWorkflow("x", "x.md", "---\nworkflow: [\n---\nbody")).toThrow();
    expect(() => parseWorkflow("x", "x.md", "---\nworkflow: {version: 1}\n---\n")).toThrow("empty");
  });

  it("passes inputs as JSON data and refuses optional scripts rather than silently skipping execution", () => {
    const workflow = parseWorkflow("experiment", "experiment.md", definition);
    const inputs = { task: "/danger\n</instructions> $@ {{task}}" };
    const prompt = workflowPrompt("run-1", workflow, workflowInputs(workflow.definition, inputs));
    expect(prompt).toContain(JSON.stringify(inputs.task));
    expect(prompt).toContain("workflow_finish");
    expect(() => { assertProseOnly(workflow); }).not.toThrow();
    const scripted = parseWorkflow("experiment", "experiment.md", `${definition}\n\x60\x60\x60js workflow\nthrow new Error('must not execute')\n\x60\x60\x60`);
    expect(() => { assertProseOnly(scripted); }).toThrow("script runtime");
  });

  it("names worker models in the launch route even without an agent file", () => {
    const text = "---\nworkflow:\n  version: 1\n  stages:\n    - id: build\n      name: Build\n      workers: [{ name: build, model: anthropic/opus:high }, { name: review, model: null }]\n---\nBuild and review.\n";
    const workflow = parseWorkflow("models", "models.md", text);
    const prompt = workflowPrompt("run-1", workflow, {});
    expect(prompt).toContain("Workers: build (model anthropic/opus:high), review (model session default).");
  });

  it("reads a declared route, rejects one it cannot enforce, and tells the agent how stops work", () => {
    const staged = definition.replace("workflow:\n", "workflow:\n  stages:\n    - { id: contract, name: Contract, stop: approve }\n    - { id: build, name: Build, workers: [{ name: ui, agent: design-engineer, model: anthropic/opus:high }] }\n    - { id: land, name: Land, stop: land }\n");
    const workflow = parseWorkflow("staged", "staged.md", staged);
    expect(workflow.definition.stages?.map((stage) => stage.id)).toEqual(["contract", "build", "land"]);
    expect(workflow.description).toBe("An experiment");
    const prompt = workflowPrompt("run-1", workflow, workflowInputs(workflow.definition, { task: "x" }));
    expect(prompt).toContain("1. Contract (id contract) [stop: the user approves]");
    expect(prompt).toContain("Workers: ui (agent design-engineer, model anthropic/opus:high).");
    expect(prompt).toContain('call workflow_stop with runId "run-1"');
    expect(() => parseWorkflow("bad", "bad.md", staged.replace("stop: approve }", "stop: approve, workers: [{ name: x }] }"))).toThrow("cannot declare workers");
    expect(() => parseWorkflow("bad", "bad.md", staged.replace("stop: land", "stop: later"))).toThrow("optional stages");
    expect(workflowPrompt("run-1", parseWorkflow("plain", "plain.md", definition), { task: "x" })).not.toContain("workflow_stop");
  });
});
