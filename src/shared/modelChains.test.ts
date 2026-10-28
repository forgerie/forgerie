import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { ModelChainsSchema, chainEntryProblem, chainNameProblem, childModelReference, modelChainsProblem, parseModelChoice, resolveModelChain, selectChainModel } from "./modelChains.js";

it.each([null, [], { "Bad-name": ["a/b"] }, { "-bad": ["a/b"] }, { good: [] }, { good: ["missing-provider"] }, { good: ["a/"] }, { good: ["a/:high"] }, { good: ["a/b/:high"] }, { good: ["a/b c"] }, { good: [5] }])("rejects invalid chains %j", (value) => { expect(Check(ModelChainsSchema, value)).toBe(false); });
it("accepts model IDs with slashes and colons, and digit-led names", () => {
  expect(Check(ModelChainsSchema, { "1-fast": ["openrouter/openai/gpt-5:high", "local/qwen:32b"] })).toBe(true);
  expect(parseModelChoice("local/qwen:32b:high")).toEqual({ model: { provider: "local", modelId: "qwen:32b" }, thinkingLevel: "high" });
});
it("applies chain thinking only to entries with no level", () => {
  expect(resolveModelChain("worker:high", { worker: ["a/one", "b/two:low"] })).toEqual(["a/one:high", "b/two:low"]);
  expect(resolveModelChain("a/one:high", {})).toEqual(["a/one:high"]);
  expect(() => resolveModelChain("missing", { worker: ["a/one"] })).toThrow('Unknown model chain "missing". Known chains: worker.');
});
it("skips cooling models independent of thinking level and chooses the earliest reset on exhaustion", () => {
  const cooldowns = { "a/one": { until: 2000, reason: "quota" }, "b/two": { until: 1500, reason: "429" } };
  expect(selectChainModel(["a/one:high", "b/two", "c/three"], cooldowns, 1000)).toEqual({ model: "c/three", exhausted: false });
  expect(selectChainModel(["a/one", "b/two"], cooldowns, 1000)).toEqual({ model: "b/two", exhausted: true });
  expect(selectChainModel(["a/one", "b/two"], cooldowns, 1500)).toEqual({ model: "b/two", exhausted: false });
});

it("keeps workflow, requested, agent-file, session precedence and workflow null semantics", () => {
  const profile = { modelReference: "agent-chain", model: { provider: "old", modelId: "model" } };
  expect(childModelReference("workflow-chain", "requested-chain", profile)).toBe("workflow-chain");
  expect(childModelReference(undefined, "requested-chain", profile)).toBe("requested-chain");
  expect(childModelReference(null, "requested-chain", profile)).toBe("agent-chain");
  expect(childModelReference(undefined, undefined, profile)).toBe("agent-chain");
  expect(childModelReference(undefined, undefined, { model: { provider: "old", modelId: "model" } })).toBe("old/model");
  expect(childModelReference(undefined, undefined)).toBeUndefined();
});

it("allows chain declarations through the workflow wire schema", async () => {
  const { WorkflowModelSchema } = await import("./workflowRuns.js");
  for (const model of ["worker", "worker:high", "openrouter/openai/gpt-5:low", "local/qwen:32b", null]) expect(Check(WorkflowModelSchema, model)).toBe(true);
  for (const model of ["bad name", "worker:unsupported-thinking", "a/", "/b", `provider/${"x".repeat(129)}`, 5]) expect(Check(WorkflowModelSchema, model)).toBe(false);
});
it("names the first problem in words, and none for a valid map", () => {
  expect(modelChainsProblem({ worker: ["a/one:high"], "2-fast": ["local/qwen:32b"] })).toBeUndefined();
  expect(modelChainsProblem({})).toBeUndefined();
  expect(modelChainsProblem(null)).toBe("modelChains must be an object that maps chain names to lists of models.");
  expect(modelChainsProblem({ good: ["a/b"], "-bad": ["a/b"] })).toBe('Chain "-bad": Use lower-case letters, digits and hyphens, and start with a letter or digit.');
  expect(modelChainsProblem({ good: ["a/b", 5] })).toBe('Chain "good": An entry is not text.');
  expect(chainNameProblem("")).toBe("Name the chain.");
  expect(chainNameProblem("worker-2")).toBeUndefined();
  expect(chainEntryProblem("a/b:high")).toBeUndefined();
  expect(chainEntryProblem("a/b c")).toBe('"a/b c" is not a provider/model-id reference.');
});
