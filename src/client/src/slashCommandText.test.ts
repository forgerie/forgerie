import { describe, expect, it } from "vitest";
import { leadingSlashCommand } from "./slashCommandText";

/**
 * The helper must agree with the send seam: text the controller would deliver
 * as a command earns a mark, and nothing else does.
 */
describe("leadingSlashCommand", () => {
  it("splits a bare command", () => {
    expect(leadingSlashCommand("/tree")).toEqual({ name: "tree", rest: "" });
  });

  it("splits a command with arguments and keeps the argument text", () => {
    expect(leadingSlashCommand("/fork keep the current draft")).toEqual({ name: "fork", rest: "keep the current draft" });
  });

  it("ignores surrounding whitespace the send seam also ignores", () => {
    expect(leadingSlashCommand("  /tree  ")).toEqual({ name: "tree", rest: "" });
  });

  it("keeps multi-line arguments after the token", () => {
    expect(leadingSlashCommand("/relay do this\nthen that")).toEqual({ name: "relay", rest: "do this\nthen that" });
  });

  it("treats a lone sigil as no command", () => {
    expect(leadingSlashCommand("/")).toBeUndefined();
  });

  it("treats prose as no command", () => {
    expect(leadingSlashCommand("hello /tree")).toBeUndefined();
  });

  it("stays faithful to the seam for path-shaped text, which the product would run", () => {
    expect(leadingSlashCommand("/nix/store/abc check this")).toEqual({ name: "nix/store/abc", rest: "check this" });
  });
});
