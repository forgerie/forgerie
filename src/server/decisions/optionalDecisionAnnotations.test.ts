import { expect, it, vi } from "vitest";
import { riskToolIdentity } from "../../shared/riskLabels.js";
import { decisionAnnotations, closeDecisionAnnotations, withRiskAnnotations, DECISION_ANNOTATION_MAX_RECORDS, DECISION_ANNOTATION_MAX_BYTES } from "./optionalDecisionAnnotations.js";

const label = {model: "fast", deletes_data: 0, outside_worktree: 0, acts_as_user: 0, risk: "low", risk_score: 0};
it.each([0, 1])("matches repeated call ids to their source invocation, not turn order (nested ordinal %s)", async ordinal => {
  const owner = {}; const store = decisionAnnotations(owner); store.setRiskVisibility(() => true);
  const first = riskToolIdentity(1, 11, "repeated", ordinal); const second = riskToolIdentity(1, 21, "repeated", ordinal);
  await store.write("1", `tool:${second.invocationId}`, {target: "tool", id: "repeated", ...second, label: {...label, model: "second"}});
  await store.write("1", `tool:${first.invocationId}`, {target: "tool", id: "repeated", ...first, label: {...label, model: "late-first"}});
  const history = [11, 21].map(assistant => ({role: "assistant", forgerieDurableEntryId: assistant,
    content: [{type: "toolCall", name: "bash", id: "repeated"}]}));
  const annotated = withRiskAnnotations(owner, 1, history);
  expect(annotated).toHaveLength(2);
  expect(annotated.map(message => message.decisionAnnotations?.[0]?.label.model)).toEqual(["late-first", "second"]);
  expect(withRiskAnnotations({}, 1, history)).not.toHaveProperty("0.decisionAnnotations");
});

it("bounds records across conversation scopes and evicts oldest insertion first", async () => {
  const store = decisionAnnotations({});
  for (let index = 0; index <= DECISION_ANNOTATION_MAX_RECORDS; index++) await store.write(String(index % 2), String(index), {index});
  expect(store.values("0").length + store.values("1").length).toBe(DECISION_ANNOTATION_MAX_RECORDS);
  expect(store.read("0", "0")).toBeUndefined(); expect(store.read("1", "1")).toEqual({index: 1});
  await store.write("1", "1", {updated: true});
  await store.write("2", "next", "next");
  expect(store.read("1", "1")).toBeUndefined();
});

it("bounds approximate serialized bytes, including multibyte values, without letting one oversized result erase the cache", async () => {
  const store = decisionAnnotations({});
  const value = "界".repeat(Math.ceil(DECISION_ANNOTATION_MAX_BYTES / 9));
  for (let index = 0; index < 4; index++) await store.write(String(index % 2), String(index), value);
  expect(store.read("0", "0")).toBeUndefined(); expect(store.read("1", "3")).toBe(value);
  const before = [...store.values("0"), ...store.values("1")];
  expect(Buffer.byteLength(JSON.stringify(before))).toBeLessThan(DECISION_ANNOTATION_MAX_BYTES);
  expect(await store.write("2", "too-big", "x".repeat(DECISION_ANNOTATION_MAX_BYTES))).toBe("discarded");
  expect(store.read("2", "too-big")).toBeUndefined();
  expect([...store.values("0"), ...store.values("1")]).toEqual(before);
});

it("family close clears records and listeners, seals queued writes, and cannot be undone by a late result", async () => {
  const owner = {}; const store = decisionAnnotations(owner); const listener = vi.fn();
  store.subscribe(listener); expect(await store.write("1", "old", {saved: true})).toBe("stored");
  const queued = store.write("1", "queued", {saved: true});
  closeDecisionAnnotations(owner); expect(await queued).toBe("discarded");
  store.subscribe(listener); expect(await store.write("1", "late", {saved: true})).toBe("discarded");
  expect(decisionAnnotations(owner)).toBe(store); expect(store.values("1")).toEqual([]);
  expect(store.read("1", "old")).toBeUndefined(); expect(listener).toHaveBeenCalledTimes(1);
});

it.each(["enabled", "risk_labels"] as const)("hides existing annotations when the live %s switch turns off", async key => {
  const live = {enabled: true, risk_labels: true}; const owner = {}; const store = decisionAnnotations(owner);
  store.setRiskVisibility(() => live.enabled && live.risk_labels);
  const identity = riskToolIdentity(1, 11, "call");
  await store.write("1", `tool:${identity.invocationId}`, {target: "tool", id: "call", ...identity, label});
  const source = [{role: "assistant", forgerieDurableEntryId: 11, content: [{type: "toolCall", id: "call", name: "bash"}]}];
  expect(withRiskAnnotations(owner, 1, source)[0]?.decisionAnnotations).toHaveLength(1);
  live[key] = false;
  expect(withRiskAnnotations(owner, 1, source)[0]?.decisionAnnotations).toBeUndefined();
  expect(store.values("1")).toHaveLength(1);
});

it("reports a discarded write if publication closes the store before acceptance returns", async () => {
  const owner = {}; const store = decisionAnnotations(owner);
  store.subscribe(() => { closeDecisionAnnotations(owner); });
  expect(await store.write("scope", "hint", "opinion")).toBe("discarded");
  expect(store.values("scope")).toEqual([]);
});
