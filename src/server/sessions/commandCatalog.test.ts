import { describe, expect, it } from "vitest";
import { buildActiveCommandCatalog, buildActiveCommandList, buildPromptResourceCatalogFromResources, expandPromptResourceCommand, resolveCanonicalCommandSource, resolvePromptResourceIdentity } from "./commandCatalog.js";

describe("canonical command catalog", () => {
  it("projects active commands with current precedence and prompt-resource eligibility", async () => {
    const catalog = await buildActiveCommandCatalog({
      builtins: [{ name: "tree", source: "builtin" }, { name: "clone", source: "builtin" }],
      extensions: [{ name: "deploy", source: "extension", description: "extension wins" }, { name: "skill:deploy", source: "extension", description: "extension wins over skill" }],
      prompts: [
        { name: "deploy", description: "prompt loses", content: "deploy $ARGUMENTS", origin: "prompt:deploy" },
        { name: "explain", description: "Explain", content: "explain $1", origin: "prompt:explain" },
      ],
      skills: [
        { name: "audit", description: "Audit", content: "skill body", origin: "skill:audit", baseDir: "skills" },
        { name: "deploy", description: "skill loses to extension", content: "skill deploy", origin: "skill:deploy", baseDir: "skills" },
      ],
    });

    expect(catalog.commands.map((command) => `${command.source}:${command.name}`)).toEqual([
      "builtin:clone",
      "extension:deploy",
      "prompt:explain",
      "skill:skill:audit",
      "extension:skill:deploy",
      "builtin:tree",
    ]);
    expect(catalog.firstPromptCommands.map((command) => `${command.source}:${command.name}`)).toEqual([
      "prompt:explain",
      "skill:skill:audit",
    ]);
    expect(catalog.firstPromptCommands[0]?.identity.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("does not advertise prompt resources shadowed by known builtins", async () => {
    const catalog = await buildPromptResourceCatalogFromResources({
      builtins: [{ name: "tree", source: "builtin" }],
      prompts: [
        { name: "tree", content: "shadowed", origin: "prompt:tree" },
        { name: "review", content: "available", origin: "prompt:review" },
      ],
      skills: [],
    });

    expect(catalog.commands.map((command) => command.name)).toEqual(["review"]);
  });

  it("projects active command descriptors without requiring prompt-resource bodies or identities", () => {
    const commands = buildActiveCommandList({
      builtins: [{ name: "tree", source: "builtin" }],
      extensions: [{ name: "skill:audit", source: "extension", description: "extension wins" }],
      prompts: [{ name: "review", description: "Review", origin: "prompt:a" }],
      skills: [{ name: "audit", description: "Audit", origin: "skill:a" }],
    });

    expect(commands).toEqual([
      { name: "review", source: "prompt", description: "Review" },
      { name: "skill:audit", source: "extension", description: "extension wins" },
      { name: "tree", source: "builtin" },
    ]);
    expect(JSON.stringify(commands)).not.toContain("fingerprint");
  });

  it("refuses a prevalidated resource identity when an active extension wins the same command name", async () => {
    const destination = await buildPromptResourceCatalogFromResources({
      prompts: [],
      skills: [{ name: "deploy", description: "Deploy", content: "deploy body", origin: "skill:deploy", baseDir: "skills" }],
    });
    const active = await buildActiveCommandCatalog({
      builtins: [],
      extensions: [{ name: "skill:deploy", source: "extension" }],
      prompts: [],
      skills: [{ name: "deploy", description: "Deploy", content: "deploy body", origin: "skill:deploy", baseDir: "skills" }],
    });

    const deployedSkill = destination.commands[0];
    if (deployedSkill === undefined) throw new Error("Expected skill command");
    expect(resolvePromptResourceIdentity(active, "/skill:deploy now", deployedSkill.identity)).toEqual({ kind: "unsupported", reason: "unknown" });
  });

  it("uses the same identity for destination and active prompt-resource catalogs", async () => {
    const resources = {
      prompts: [{ name: "review", description: "Review", content: "review $ARGUMENTS", origin: "prompt:review" }],
      skills: [{ name: "audit", description: "Audit", content: "skill body", origin: "skill:audit", baseDir: "skills" }],
    };
    const destination = await buildPromptResourceCatalogFromResources(resources);
    const active = await buildActiveCommandCatalog({ builtins: [], extensions: [], ...resources });

    const review = destination.commands.find((command) => command.name === "review");
    if (review === undefined) throw new Error("Expected review command");
    expect(destination.commands).toEqual(active.firstPromptCommands);
    expect(resolvePromptResourceIdentity(active, "/review src", review.identity)).toMatchObject({ kind: "matched", command: { name: "review", source: "prompt" }, args: "src" });
    expect(resolvePromptResourceIdentity(active, "/rev", review.identity)).toEqual({ kind: "unsupported", reason: "unknown" });
  });

  it("chooses same-source resource collisions deterministically by origin without exposing origin in descriptors", async () => {
    const catalog = await buildPromptResourceCatalogFromResources({
      prompts: [
        { name: "review", description: "Loses", content: "second", origin: "prompt:z" },
        { name: "review", description: "Wins", content: "first", origin: "prompt:a" },
      ],
      skills: [],
    });

    expect(catalog.commands).toHaveLength(1);
    expect(catalog.commands[0]).toMatchObject({ name: "review", source: "prompt", description: "Wins" });
    expect(catalog.commands[0]).not.toHaveProperty("origin");
  });

  it("expands prompt and skill arguments the same way the installed Pi runtime does", () => {
    expect(expandPromptResourceCommand({
      name: "review",
      source: "prompt",
      identity: { source: "prompt", name: "review", fingerprint: "a".repeat(64) },
      content: "Review $1 then ${2:-fallback}; all=$ARGUMENTS; tail=${@:2}",
      origin: "prompt:review",
    }, "src 'quoted value'")).toBe("Review src then quoted value; all=src quoted value; tail=quoted value");

    expect(expandPromptResourceCommand({
      name: "skill:audit",
      source: "skill",
      identity: { source: "skill", name: "skill:audit", fingerprint: "b".repeat(64) },
      content: "---\ndescription: Audit\n---\nUse tools\n",
      origin: "skill:audit",
      baseDir: "/repo/.pi/skills/audit",
      filePath: "/repo/.pi/skills/audit/SKILL.md",
    }, " src ")).toBe(`<skill name="audit" location="/repo/.pi/skills/audit/SKILL.md">
References are relative to /repo/.pi/skills/audit.

Use tools
</skill>

src`);
  });

  it("resolves runtime command names through the same exact precedence policy", () => {
    const input = {
      builtins: [{ name: "tree", source: "builtin" as const }],
      extensions: [{ name: "tree", source: "extension" as const }, { name: "skill:deploy", source: "extension" as const }],
      prompts: [{ name: "skill:audit" }, { name: "deploy" }],
      skills: [{ name: "audit" }, { name: "deploy" }],
    };

    expect(resolveCanonicalCommandSource(input, "tree")).toBe("builtin");
    expect(resolveCanonicalCommandSource(input, "skill:deploy")).toBe("extension");
    expect(resolveCanonicalCommandSource(input, "skill:audit")).toBe("skill");
    expect(resolveCanonicalCommandSource(input, "deploy")).toBe("prompt");
    expect(resolveCanonicalCommandSource(input, "Deploy")).toBeUndefined();
  });
});
