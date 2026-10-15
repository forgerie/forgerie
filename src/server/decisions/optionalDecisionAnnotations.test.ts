import { expect, it } from "vitest";
import { decisionAnnotations, withRiskAnnotations } from "./optionalDecisionAnnotations.js";

it("keeps old labels with their source turn, never as a tail that can hide recent required history", async () => {
  const owner = {};
  const store = decisionAnnotations(owner);
  const label = { model: "fast", deletes_data: 0, outside_worktree: 0, acts_as_user: 0, risk: "low", risk_score: 0 };
  await store.write("1", "tool:old", { target: "tool", id: "old", label });
  await store.write("1", "tool:orphan", { target: "tool", id: "orphan", label });
  await store.write("2", "tool:old", { target: "tool", id: "old", label: { ...label, model: "other-conversation" } });
  const history = [{ role: "user", content: "Old turn" }, { role: "assistant", content: [{ type: "toolCall", name: "bash", id: "old" }] }, { role: "user", content: "Latest required input" }, { role: "assistant", content: "Latest required reply" }];
  const annotated = withRiskAnnotations(owner, 1, history);
  expect(annotated).toHaveLength(5);
  expect(annotated[2]).toMatchObject({ role: "custom", details: { id: "old", label: { model: "fast" } } });
  expect(annotated.slice(-2)).toEqual(history.slice(-2));
  expect(JSON.stringify(annotated)).not.toContain("orphan");
  expect(JSON.stringify(annotated)).not.toContain("other-conversation");
  expect(withRiskAnnotations({}, 1, history)).toEqual(history);
});
