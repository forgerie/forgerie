import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledForgerieAgentsPath } from "./bundledForgerieSkills.js";
import { ChildAgentCatalog, parseChildAgentFile } from "./durableChildProfiles.js";
import { planChildRuntime, runtimeGaps } from "./durableChildRuntime.js";
import { diffInputProblem, page, DIFF_PAGE_CHARS } from "./durableChildTools.js";

import { imageType } from "./readImageSafety.js";

// The agent files sessiond really falls back to.
const bundled = bundledForgerieAgentsPath();
const bundledAgent = async (name: string) => {
  const path = join(bundled, `${name}.md`);
  const profile = parseChildAgentFile(await readFile(path), path);
  if (profile === undefined) throw new Error(`Bundled agent ${name} did not parse`);
  return profile;
};

let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "forgerie-child-runtime-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function skill(dir: string, name: string, description: string) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  return { name, description, path: join(dir, name, "SKILL.md") };
}

describe("an agent file in a Durable child", () => {
  it("translates pi-subagents tool names to this runtime's tools, and says how they differ", () => {
    const profile = parseChildAgentFile("---\nname: legacy-reviewer\ndescription: Review\ntools: read, grep, bash, watchdog_diff, contact_supervisor\n---\nReview.\n", join(root, "legacy-reviewer.md"));
    const plan = planChildRuntime(profile, [], []);
    expect([...(plan.tools ?? [])].sort()).toEqual(["ask_human", "bash", "read", "watchdog_diff"]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.section).toContain("contact_supervisor is ask_human here");
    expect(plan.section).toContain("watchdog_diff reads committed ranges here");
    expect(plan.section).toContain("read also opens PNG");
    expect(runtimeGaps(plan)).toBe("");
  });

  it("gives a child that may run bash the managed process tool, when the session has it", () => {
    const shell = parseChildAgentFile("---\nname: builder\ndescription: Build\ntools: read, bash\n---\nBuild.\n", join(root, "builder.md"));
    expect(planChildRuntime(shell, ["process"], []).tools).toContain("process");
    expect(planChildRuntime(shell, [], []).tools).not.toContain("process");
    const reader = parseChildAgentFile("---\nname: reader\ndescription: Read\ntools: read\n---\nRead.\n", join(root, "reader.md"));
    expect(planChildRuntime(reader, ["process"], []).tools).not.toContain("process");
  });

  it("gives the bundled researcher the session tools its file names", async () => {
    const plan = planChildRuntime(await bundledAgent("researcher"), ["web_search", "fetch_content"], []);
    expect(plan.tools).toEqual(expect.arrayContaining(["web_search", "fetch_content"]));
    expect(plan.unavailable).not.toContain("web_search");
    expect(plan.unavailable).not.toContain("fetch_content");
  });

  it("reports missing named tools in the child's instructions and the parent's spawn result", async () => {
    const plan = planChildRuntime(await bundledAgent("researcher"), ["web_search"], []);
    expect(plan.unavailable).toContain("fetch_content");
    expect(plan.tools).not.toContain("fetch_content");
    expect(plan.section).toContain("Not available here: fetch_content");
    expect(runtimeGaps(plan)).toContain("Not available to it here: tools fetch_content");
  });

  it("lists the skills the file names, from its own skill folder first, and reports the ones it cannot find", async () => {
    const own = join(root, "own-skills");
    const session = join(root, "session-skills");
    const local = await skill(own, "frontend-design", "Local copy");
    await skill(session, "frontend-design", "Session copy");
    const intrinsic = await skill(session, "intrinsic-design", "Layout from the container");
    await mkdir(join(root, "agents"));
    const path = join(root, "agents", "design-engineer.md");
    const profile = parseChildAgentFile(`---\nname: design-engineer\ndescription: UI\ntools: read, bash, edit, write, contact_supervisor\nskillPath: ../own-skills\nskills: frontend-design, intrinsic-design, mobbin-reference\ninheritSkills: false\n---\nBuild UI.\n`, path);
    const plan = planChildRuntime(profile, [], [{ ...intrinsic }, { name: "frontend-design", description: "Session copy", path: join(session, "frontend-design", "SKILL.md") }, { name: "unrelated", description: "x", path: "/x" }]);
    expect(plan.skills).toEqual([local, intrinsic]);
    expect(plan.missingSkills).toEqual(["mobbin-reference"]);
    expect(plan.section).toContain(`<location>${local.path}</location>`);
    expect(plan.section).not.toContain("unrelated");
    expect(runtimeGaps(plan)).toBe(" Not available to it here: skills mobbin-reference.");
  });

  it("offers every tool and adds nothing for a general helper", () => {
    const plan = planChildRuntime(undefined, [], []);
    expect(plan.tools).toBeUndefined();
    expect(plan.section).toContain("read also opens PNG");
    expect(plan.unavailable).toEqual([]);
  });
});

describe("Forgerie's own agent files", () => {
  it("serve the reviewer with every tool it names and nothing that contradicts this runtime", async () => {
    const catalog = ChildAgentCatalog.forSession(root, join(root, "profile"), { builtin: [bundled] });
    const reviewer = await catalog.find("reviewer");
    expect(reviewer?.source.path).toBe(join(bundledForgerieAgentsPath(), "reviewer.md"));
    const plan = planChildRuntime(reviewer, [], []);
    expect([...(plan.tools ?? [])].sort()).toEqual(["ask_human", "bash", "read", "watchdog_diff"]);
    expect(plan.unavailable).toEqual([]);
    expect(reviewer?.prompt).toContain("Pass `range` for committed work");
    expect(reviewer?.prompt).not.toMatch(/does not inspect committed ranges|Do not use shell commands/u);
    // The other built-ins resolve, and every one of them parses and has a description.
    for (const name of ["worker", "scout", "delegate", "researcher", "evidence-auditor"]) {
      const agent = await catalog.find(name);
      expect(agent?.source.path).toBe(join(bundled, `${name}.md`));
      expect(agent?.description).not.toBe("");
      expect(planChildRuntime(agent, ["web_search", "fetch_content", "get_search_content", "source_check"], []).unavailable).toEqual([]);
    }
  });
});

describe("watchdog_diff input and paging", () => {
  it("accepts revisions and ranges and refuses option-like input", () => {
    for (const range of ["main", "3e72540c..HEAD", "main...c-22432a39", "HEAD~3..HEAD", "origin/main...feat/x"]) expect(diffInputProblem(range, undefined)).toBeUndefined();
    for (const range of ["--output=/tmp/x", "a..b..c", "main;rm", "", "a..-b"]) expect(diffInputProblem(range, undefined)).toBeDefined();
    expect(diffInputProblem(undefined, "ui/src")).toBeUndefined();
    for (const path of ["-x", "/etc", "../up"]) expect(diffInputProblem(undefined, path)).toBeDefined();
  });

  it("pages a long diff and says where the next page starts", () => {
    const text = "x".repeat(DIFF_PAGE_CHARS + 10);
    expect(page(text, 0)).toContain(`call again with offset ${String(DIFF_PAGE_CHARS)}`);
    expect(page(text, DIFF_PAGE_CHARS)).toBe("x".repeat(10));
    expect(page("short", 0)).toBe("short");
  });

  it("knows image types by their first bytes", () => {
    expect(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(imageType(new TextEncoder().encode("plain text"))).toBeUndefined();
  });
});
