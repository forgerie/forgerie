import { describe, expect, it } from "vitest";
import { draftKey, readTarget, targetParam } from "./agentPlace";

describe("agent settings places", () => {
  it("round-trips a file in ~/.agents through the URL", () => {
    expect(readTarget(targetParam({ type: "home", file: "researcher" }))).toEqual({ type: "home", file: "researcher" });
    expect(readTarget("elsewhere/researcher")).toBeUndefined();
  });

  it("keeps a draft per file it will be saved to", () => {
    expect(draftKey({ type: "home", file: "researcher" })).toBe("home:researcher");
    expect(draftKey({ type: "user", file: "researcher" })).toBe("user:researcher");
    // A customized built-in saves to the profile, so it shares the profile file's draft.
    expect(draftKey({ type: "customize", file: "scout" })).toBe("user:scout");
    expect(draftKey({ type: "builtin", file: "scout" })).toBe("builtin:scout");
    expect(draftKey({ type: "new" })).toBe("new");
  });
});
