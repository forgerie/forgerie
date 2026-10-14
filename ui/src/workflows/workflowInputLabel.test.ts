import { expect, it } from "vitest";
import { workflowInputLabel } from "./workflowInputLabel";

it("uses a declared label, or sentence-case words for old input keys", () => {
  expect(workflowInputLabel("trial_port")).toBe("Trial port");
  expect(workflowInputLabel("rollbackDays")).toBe("Rollback days");
  expect(workflowInputLabel("task", "Task to run")).toBe("Task to run");
  expect(workflowInputLabel("rounds", "  ")).toBe("Rounds");
});
