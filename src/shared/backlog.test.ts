import { expect, it } from "vitest";
import { Check } from "typebox/value";
import { BacklogGitHubConfigSchema } from "./backlog.js";

it("accepts up to 20 distinct bot logins and leaves the optional setting absent", () => {
  expect(Check(BacklogGitHubConfigSchema, {})).toBe(true);
  expect(Check(BacklogGitHubConfigSchema, { trustedBots: [] })).toBe(true);
  expect(Check(BacklogGitHubConfigSchema, { trustedBots: ["CodeRabbitAI[bot]", `${"a".repeat(39)}[bot]`] })).toBe(true);
  expect(Check(BacklogGitHubConfigSchema, { trustedBots: Array.from({ length: 20 }, (_, i) => `bot-${String(i)}[bot]`) })).toBe(true);
});

it.each([
  ["coderabbitai"], ["bot[bot]", "bot[bot]"], ["-bot[bot]"], ["bot[Bot]"],
  ["bot_name[bot]"], [`${"a".repeat(40)}[bot]`], ["bot[bot]\n"],
  Array.from({ length: 21 }, (_, i) => `bot-${String(i)}[bot]`),
])("rejects invalid trusted bot entries: %j", (...trustedBots) => {
  expect(Check(BacklogGitHubConfigSchema, { trustedBots })).toBe(false);
});
