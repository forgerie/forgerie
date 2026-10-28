// Model chains for parts and tests: the models a signed-in provider offers, chains, and the agents that name them.
import type { SessionModel } from "../../contracts";
import type { ModelChains } from "@shared/modelChains";

export const MODELS: SessionModel[] = [
  { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", reasoning: true },
  { provider: "local", id: "llama3:8b", name: "Llama 3 8B", reasoning: false },
];
export const CHAINS: ModelChains = {
  worker: ["anthropic/claude-opus-5-5:high", "openai/gpt-5", "openai/gpt-5-mini:low"],
  fast: ["anthropic/claude-haiku-4-5"],
};
export const AGENTS = [
  { name: "Worker", model: "worker:medium" },
  { name: "Reviewer", model: "worker" },
  { name: "Scout", model: "anthropic/claude-haiku-4-5" },
];
export const WHERE = "~/.config/forgerie/config.json";
/** The most a chain holds, with a model no signed-in provider offers among them. */
export const FULL_CHAIN = [...Array.from({ length: 15 }, (_, index) => index % 2 === 0 ? "openai/gpt-5" : "anthropic/claude-haiku-4-5"), "retired/claude-instant-1"];
/** A name as long as a file allows, with no break in it. */
export const LONG_NAME = "nightly-regression-triage-with-the-cheapest-model-that-still-reads-diffs";
