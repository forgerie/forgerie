import { describe, expect, it } from "vitest";
import { fingerprintPromptResourceCommand, fingerprintPromptResourceDeliveryText, parseLeadingSlashCommand } from "./promptResourceCommand.js";

describe("prompt resource command policy", () => {
  it("parses only offset-zero slash commands and preserves the text after the first whitespace separator", () => {
    expect(parseLeadingSlashCommand("/skill:review  --flag  value")).toEqual({ name: "skill:review", args: " --flag  value" });
    expect(parseLeadingSlashCommand(" /skill:review")).toEqual({ kind: "not-command" });
    expect(parseLeadingSlashCommand("/")).toEqual({ kind: "invalid", reason: "missing-name" });
    expect(parseLeadingSlashCommand("/ skill:review")).toEqual({ kind: "invalid", reason: "missing-name" });
    expect(parseLeadingSlashCommand("/skill:review\nnext")).toEqual({ name: "skill:review", args: "next" });
    expect(parseLeadingSlashCommand("/skill:review\t\tquoted  text")).toEqual({ name: "skill:review", args: "\tquoted  text" });
  });

  it("uses exact code points and content in opaque fingerprints", async () => {
    const base = await fingerprintPromptResourceCommand({
      source: "skill",
      name: "skill:Café",
      origin: "skill:project:review",
      content: "body",
      baseDir: "project",
    });
    expect(base).toMatch(/^[a-f0-9]{64}$/u);
    await expect(fingerprintPromptResourceCommand({ source: "skill", name: "skill:Café", origin: "skill:project:review", content: "body", baseDir: "project" })).resolves.not.toBe(base);
    await expect(fingerprintPromptResourceCommand({ source: "skill", name: "skill:Café", origin: "skill:project:review", content: "changed", baseDir: "project" })).resolves.not.toBe(base);
    await expect(fingerprintPromptResourceCommand({ source: "skill", name: "skill:Café", origin: "skill:project:review", content: "body", baseDir: "" })).resolves.not.toBe(
      await fingerprintPromptResourceCommand({ source: "skill", name: "skill:Café", origin: "skill:project:review", content: "body" }),
    );
  });

  it("fingerprints only the canonical delivery text for prompt-resource receipts", async () => {
    const base = await fingerprintPromptResourceDeliveryText("Review src");

    expect(base).toMatch(/^[a-f0-9]{64}$/u);
    await expect(fingerprintPromptResourceDeliveryText("Review src")).resolves.toBe(base);
    await expect(fingerprintPromptResourceDeliveryText("/review src")).resolves.not.toBe(base);
    await expect(fingerprintPromptResourceDeliveryText("Review src\n")).resolves.not.toBe(base);
  });
});
