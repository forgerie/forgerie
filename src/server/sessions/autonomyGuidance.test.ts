import { AUTONOMY_GUIDANCE } from "./autonomyGuidance.js";
import { decisionExtension } from "./durableDecisions.js";
import { expect, it } from "vitest";
import { createAskUserToolDefinition } from "./askUserTool.js";
import { createEndTurnToolDefinition } from "./endTurnTool.js";
import { durableChildExtensions } from "./durableChildAgents.js";

it("gives ask_user, end_turn and child_agent the same autonomy rule", () => {
  const ask = createAskUserToolDefinition({ open: () => { throw new Error("No question should be posted"); } });
  const end = createEndTurnToolDefinition({ declare: () => undefined });
  const child = durableChildExtensions().parent.flatMap(extension => extension.tools ?? []).find(tool => tool.name === "child_agent");
  for (const description of [ask.description, ask.promptGuidelines?.join("\n"), end.promptGuidelines?.join("\n"), child?.description]) {
    expect(description).toContain(AUTONOMY_GUIDANCE);
  }
});

it("keeps loss, external effects and expensive product intent separate from routine work", () => {
  for (const rule of [
    "Loss that Git, a backup or a rebuild cannot restore",
    "Actions toward other people or outside services in the user's name",
    "Product intent that the chat, the code and the docs do not decide, when a wrong guess is expensive to undo",
    "Do everything else in scope without asking, and report it afterwards",
    "Build, test, commit, land, push branches",
    "deploy to targets the project already deploys to",
    "Restart services and daemons, including Forgerie",
    "even when a game or app is running on them",
    "Install tools and dependencies",
    "Make keys or tokens on the user's own machines",
    "These are requests for help, not permission",
    "Respect an explicit user request to be consulted",
    "Do not end a run to offer the next step",
    "Where record_decision exists, record the choice with guess: true",
    "Existing tool gates still apply",
  ]) expect(AUTONOMY_GUIDANCE).toContain(rule);
});

it("reserves awaiting=reply for the autonomy rule, physical help or explicit consultation", () => {
  const end = createEndTurnToolDefinition({ declare: () => undefined });
  const guidance = end.promptGuidelines?.join("\n");
  expect(guidance).toContain("only for categories (a), (b), (c)");
  expect(guidance).toContain("a physical or observation request");
  expect(guidance).toContain("when the user explicitly asked to be consulted");
  expect(guidance).toContain("including an in-scope next step you would otherwise offer to do");
  expect(guidance).not.toContain("whenever you want");
});

it("records open choices under the same rule instead of demanding ordinary permission", () => {
  const tool = decisionExtension().tools?.find(tool => tool.name === "record_decision");
  expect(tool?.description).toContain(AUTONOMY_GUIDANCE);
  expect(tool?.description).toContain("leave a choice open");
  expect(tool?.description).not.toContain("Do not log ordinary notable choices");
});

it("keeps expensive product intent out of provisional child guesses", () => {
  const child = durableChildExtensions().parent.flatMap(extension => extension.tools ?? []).find(tool => tool.name === "child_agent");
  expect(child?.description).toContain("Use irreversible/external only for categories (a)/(b)");
  expect(child?.description).toContain("use ask_user, then answer the child from the user's reply");
  expect(child?.description).toContain("do not use them for category (c)");
});
