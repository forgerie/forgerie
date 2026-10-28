import { expect, it } from "vitest";
import { sessionModelSelectionSchema } from "./sessionModelSelection.js";

it("admits one explicit chain or a complete concrete model, never both", () => {
  expect(sessionModelSelectionSchema.parse({ modelChain: "worker" })).toEqual({ modelChain: "worker" });
  expect(sessionModelSelectionSchema.parse({ provider: "openai", modelId: "gpt-5" })).toEqual({ provider: "openai", modelId: "gpt-5" });
  for (const body of [{}, { provider: "openai" }, { modelChain: "worker", provider: "openai", modelId: "gpt-5" }, { modelChain: "" }]) {
    expect(sessionModelSelectionSchema.safeParse(body).success).toBe(false);
  }
});
