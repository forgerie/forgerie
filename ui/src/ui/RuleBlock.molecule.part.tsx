import { useState } from "react";
import { RuleBlock } from "./RuleBlock";

export const name = "Rule block";
export const note = "Something to read before the text under it, marked by a rule on the start side, with lines to take back";

const LINES = ["New stage Docs, after Review.", "Removed worker `scout` from Shape.", "New worker `reviewer-2` (reviewer) in Review."];

/** Real handlers: each undo takes its line back, and Undo all takes every one. */
export default function Changes() {
  const [lines, setLines] = useState(LINES);
  return <RuleBlock title="The plan does not match your route yet" tone="warn" action={{ label: "Undo all", onPress: () => setLines([]) }}
    items={lines.map((text) => ({ key: text, text, undo: { label: "Undo this change", onPress: () => setLines((current) => current.filter((line) => line !== text)) } }))}
    note="Update the plan to send these to the agent. It rewrites the plan, then you start the new one." />;
}
export function Result() {
  return <RuleBlock title="Finished"><p>Landed both branches. The export endpoint and the button are on main.</p></RuleBlock>;
}
export function Failure() {
  return <RuleBlock title="Failed" tone="bad"><p>The build worker failed: the tests did not compile.</p></RuleBlock>;
}
