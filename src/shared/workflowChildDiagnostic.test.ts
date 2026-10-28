import { expect, it } from "vitest";
import { workflowChildDiagnostic } from "./workflowChildDiagnostic.js";

it("projects failed submissions and reporter errors with the same category-only sanitizer", () => {
  const error = "Invalid API key: private-fixture-secret";
  expect(workflowChildDiagnostic({ kind: "settled", outcome: "failed", result: error, deliveryError: error, delivered: false })).toEqual({ kind: "settled", outcome: "failed", result: "invalid credentials", deliveryError: "invalid credentials", delivered: false });
});
it("does not truncate legitimate child answers while redacting reporter faults", () => {
  const answer = "Legitimate answer. ".repeat(100);
  const result = workflowChildDiagnostic({ kind: "settled", outcome: "answered", result: answer, delivered: false, deliveryError: "Reporter failed: token private-fixture-secret" });
  expect(result).toMatchObject({ kind: "settled", result: answer }); expect(JSON.stringify(result)).not.toContain("private-fixture-secret");
});
