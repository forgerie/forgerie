import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import type { ModelChains } from "@shared/modelChains";
import { ModelChainsSection } from "./ModelChainsSection";
import { AGENTS, CHAINS, FULL_CHAIN, LONG_NAME, MODELS, WHERE } from "./fixtures/chains";

export const name = "Model chains";
export const note = "Settings > Models > Model chains: named, ordered model lists that agents can choose as their model";
export const checks = {
  default: {
    "Move down saves the new order": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Move Claude Opus 5.5 down" }));
      expect(canvas.getByRole("list", { name: "Models in worker, first tried first" }).querySelector("li")).toHaveTextContent("GPT-5");
    },
    "deleting a chain that agents name warns first": async ({ canvas, within, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "More commands for worker" }));
      // The menu opens at window level, outside the part's host.
      await input.click(await within(document.body).findByRole("menuitem", { name: "Delete chain" }));
      expect(canvas.getByText(/Worker and Reviewer name this chain/)).toBeVisible();
    },
  },
  Empty: {
    "a new chain needs a valid name": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "New chain" }));
      await input.type(canvas.getByRole("textbox", { name: "New chain" }), "Fast Lane");
      await input.click(canvas.getByRole("button", { name: "Create" }));
      expect(canvas.getByRole("alert")).toHaveTextContent("Use lower-case letters, digits and hyphens");
    },
  },
} satisfies StateChecks;

function Stateful({ start, agentsUnknown = false, problem = null, locked = false }: {
  start: ModelChains; agentsUnknown?: boolean; problem?: string | null; locked?: boolean;
}) {
  const [chains, setChains] = useState(start);
  return <ModelChainsSection chains={chains} problem={problem} models={MODELS} agents={agentsUnknown ? undefined : AGENTS} locked={locked} where={WHERE} onChange={setChains} />;
}
export default function Chains() { return <Stateful start={CHAINS} />; }
export function Empty() { return <Stateful start={{}} />; }
/** A name with no break in it, a chain at its limit with a model no provider offers, and agents not read yet. */
export function Long() { return <Stateful start={{ [LONG_NAME]: ["openai/gpt-5-mini:minimal", "local/llama3:8b"], full: FULL_CHAIN }} agentsUnknown />; }
/** The file's chains break the rules, so Forgerie ignores them all and the section changes nothing. */
export function InvalidFile() {
  return <Stateful start={{ worker: ["anthropic/claude-opus-5-5", "missing-provider"] }}
    problem={'Chain "worker": "missing-provider" is not a provider/model-id reference.'} />;
}
/** A save failed: nothing changes until the page reads the lists again. */
export function Locked() { return <Stateful start={CHAINS} locked />; }
