import { describe, expect, it } from "vitest";
import { parseSkillInvocation, skillLoadOf } from "./skills";

const block = (body = "References are relative to /skills/handoff.\n\n# Handoff\n\nCall the tool.") =>
  `<skill name="handoff" location="/skills/handoff/SKILL.md">\n${body}\n</skill>`;

describe("skill invocations", () => {
  it("reads Pi's expanded block and keeps the typed argument on the invocation", () => {
    expect(parseSkillInvocation(`${block()}\n\nSending while working`)).toEqual({
      name: "handoff", location: "/skills/handoff/SKILL.md",
      content: "References are relative to /skills/handoff.\n\n# Handoff\n\nCall the tool.",
      argument: "Sending while working",
    });
  });

  it("has no argument when the command had none or only whitespace", () => {
    expect(parseSkillInvocation(block())).not.toHaveProperty("argument");
    expect(parseSkillInvocation(`${block()}\n\n  \n`)).not.toHaveProperty("argument");
  });

  it("keeps a multi-line argument intact", () => {
    expect(parseSkillInvocation(`${block()}\n\nfirst line\n\nsecond line`)?.argument).toBe("first line\n\nsecond line");
  });

  it("treats anything else as ordinary text", () => {
    expect(parseSkillInvocation("Please read <skill name=\"x\" location=\"y\">")).toBeUndefined();
    expect(parseSkillInvocation(`intro\n${block()}`)).toBeUndefined();
    expect(parseSkillInvocation(block().replace("</skill>", ""))).toBeUndefined();
    expect(parseSkillInvocation("")).toBeUndefined();
  });
});

describe("skill loads", () => {
  it("recognizes a read of a skill's SKILL.md and names the skill by its directory", () => {
    expect(skillLoadOf("read", { path: "/home/me/.agents/skills/simple-english/SKILL.md" }))
      .toEqual({ name: "simple-english", path: "/home/me/.agents/skills/simple-english/SKILL.md" });
    expect(skillLoadOf("read", { path: ".agents/skills/testing-guide/SKILL.md", offset: 1, limit: 40 }))
      .toEqual({ name: "testing-guide", path: ".agents/skills/testing-guide/SKILL.md" });
    expect(skillLoadOf("read", { path: "C:\\skills\\review\\SKILL.md" })?.name).toBe("review");
  });

  it("leaves every other call as a tool", () => {
    expect(skillLoadOf("read", { path: "SKILL.md" })).toBeUndefined();
    expect(skillLoadOf("read", { path: "./SKILL.md" })).toBeUndefined();
    expect(skillLoadOf("read", { path: "../SKILL.md" })).toBeUndefined();
    expect(skillLoadOf("read", { path: "/skills/x/README.md" })).toBeUndefined();
    expect(skillLoadOf("read", { path: "/skills/x/SKILL.md.bak" })).toBeUndefined();
    expect(skillLoadOf("bash", { command: "cat /skills/x/SKILL.md", path: "/skills/x/SKILL.md" })).toBeUndefined();
    expect(skillLoadOf("read", undefined)).toBeUndefined();
    expect(skillLoadOf("read", ["/skills/x/SKILL.md"])).toBeUndefined();
  });
});
