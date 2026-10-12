import { describe, expect, it } from "vitest";
import { replacedBy, type AgentSummary } from "./agentsApi";

const agent = (scope: AgentSummary["scope"], name: string): AgentSummary =>
  ({ scope, file: name, name, description: "", advertise: false, disabled: false, mtimeMs: 0 });

describe("which agent sessions use", () => {
  it("ranks ~/.agents over the profile, and both over built-in agents", () => {
    const agents = [agent("home", "researcher"), agent("user", "researcher"), agent("builtin", "researcher"), agent("user", "scout"), agent("builtin", "scout"), agent("builtin", "worker")];
    expect(agents.map((each) => replacedBy(each, agents))).toEqual([
      undefined, "Replaced by your shared agent", "Replaced by your shared agent", undefined, "Replaced by yours", undefined,
    ]);
  });
});
